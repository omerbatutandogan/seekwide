import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { projectPaths } from '../../plugin/server/src/store/project.js';
import { readProfile, writeProfile } from '../../plugin/server/src/store/profile.js';

const NOW = new Date('2026-11-11T14:03:22.000Z');

/** @param {import('node:test').TestContext} t */
async function makeDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'seekwide-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * @param {unknown} promise
 * @returns {Promise<Error & {code?: string, fields?: {field: string, message: string}[]}>}
 */
async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return /** @type {any} */ (error);
  }
  throw new assert.AssertionError({ message: 'Expected the promise to reject' });
}

const FULL = {
  site_url: 'https://example.com',
  brand: { name: 'Example', alternate_names: ['Example Inc', 'Example Co'] },
  business_model: 'ecommerce',
  markets: [{ country: 'US', languages: ['en'] }, { country: 'DE', languages: ['de', 'en'] }],
  competitors: ['rival.com', 'other.example'],
  target_queries: ['buy widgets', 'widget shop'],
  report: { brand_name: 'Acme Agency', logo_path: '/work/logo.png' },
};

test('readProfile returns null when no profile was saved, and creates nothing', async (t) => {
  const dir = await makeDir(t);
  assert.equal(await readProfile(dir), null);
  await assert.rejects(fs.stat(path.join(dir, '.seekwide')), { code: 'ENOENT' });
});

test('writeProfile saves a minimal profile with schema_version and updated_at', async (t) => {
  const dir = await makeDir(t);
  const saved = await writeProfile(dir, { site_url: 'https://example.com', brand: { name: 'Example' } }, NOW);
  assert.deepEqual(saved, {
    schema_version: 1,
    site_url: 'https://example.com/',
    brand: { name: 'Example' },
    updated_at: '2026-11-11T14:03:22.000Z',
  });
  assert.deepEqual(await readProfile(dir), saved);
  const text = await fs.readFile(projectPaths(dir).profile, 'utf8');
  assert.deepEqual(JSON.parse(text), saved);
  assert.ok(text.endsWith('}\n'));
});

test('writeProfile keeps every optional field and read returns the same profile', async (t) => {
  const dir = await makeDir(t);
  const saved = await writeProfile(dir, FULL, NOW);
  assert.deepEqual(saved, { schema_version: 1, ...FULL, site_url: 'https://example.com/', updated_at: NOW.toISOString() });
  assert.deepEqual(await readProfile(dir), saved);
  assert.deepEqual(Object.keys(saved), ['schema_version', 'site_url', 'brand', 'business_model', 'markets', 'competitors', 'target_queries', 'report', 'updated_at']);
});

test('writeProfile accepts `now` as a Date or as a function returning one', async (t) => {
  const dir = await makeDir(t);
  const input = { site_url: 'https://example.com', brand: { name: 'Example' } };
  assert.equal((await writeProfile(dir, input, () => NOW)).updated_at, NOW.toISOString());
  await assert.rejects(writeProfile(dir, input, /** @type {any} */ ('2026-11-11')), TypeError);
  await assert.rejects(writeProfile(dir, input, new Date('nope')), TypeError);
});

test('writeProfile normalizes what it stores', async (t) => {
  const dir = await makeDir(t);
  const saved = await writeProfile(
    dir,
    {
      site_url: ' HTTPS://Example.COM/shop?utm_source=x#top ',
      brand: { name: '  Example \n  Inc  ', alternate_names: ['Ex', ' Ex ', 'Ex', 'Example'] },
      markets: [{ country: ' us ', languages: ['EN', 'en', 'pt-br'] }],
      competitors: [' rival.com ', 'rival.com'],
      target_queries: ['a   b', 'a b'],
      report: { brand_name: '  Acme  ' },
    },
    NOW,
  );
  assert.equal(saved.site_url, 'https://example.com/shop');
  assert.equal(saved.brand.name, 'Example Inc');
  assert.deepEqual(saved.brand.alternate_names, ['Ex', 'Example']);
  assert.deepEqual(saved.markets, [{ country: 'US', languages: ['en', 'pt-BR'] }]);
  assert.deepEqual(saved.competitors, ['rival.com']);
  assert.deepEqual(saved.target_queries, ['a b']);
  assert.deepEqual(saved.report, { brand_name: 'Acme' });
});

test('writeProfile replaces the earlier profile instead of merging', async (t) => {
  const dir = await makeDir(t);
  await writeProfile(dir, FULL, NOW);
  const second = await writeProfile(dir, { site_url: 'https://other.example', brand: { name: 'Other' } }, new Date('2026-12-01T00:00:00Z'));
  assert.deepEqual(await readProfile(dir), second);
  assert.equal(second.competitors, undefined);
  assert.equal(second.updated_at, '2026-12-01T00:00:00.000Z');
});

test('writeProfile ignores schema_version and updated_at in the input', async (t) => {
  const dir = await makeDir(t);
  const saved = await writeProfile(dir, { schema_version: 99, updated_at: 'yesterday', site_url: 'https://example.com', brand: { name: 'E' } }, NOW);
  assert.equal(saved.schema_version, 1);
  assert.equal(saved.updated_at, NOW.toISOString());
});

test('an invalid profile with several bad fields names every one of them and writes nothing', async (t) => {
  const dir = await makeDir(t);
  const error = await rejection(
    writeProfile(
      dir,
      {
        site_url: 'ftp://example.com',
        brand: { name: '   ', alternate_names: ['ok', 5] },
        business_model: 'lemonade_stand',
        markets: [{ country: 'USA', languages: [] }, { country: 'FR', languages: ['not a tag'] }, 'FR'],
        competitors: 'rival.com',
        target_queries: ['x'.repeat(201)],
        report: { logo_path: '' },
        colour: 'red',
      },
      NOW,
    ),
  );
  assert.equal(error.code, 'INVALID_PROFILE');
  const expected = [
    'site_url', 'brand.name', 'brand.alternate_names[1]', 'business_model', 'markets[0].country', 'markets[0].languages',
    'markets[1].languages[0]', 'markets[2]', 'competitors', 'target_queries[0]', 'report.logo_path', 'colour',
  ];
  for (const field of expected) assert.ok(error.message.includes(field), `message does not name ${field}: ${error.message}`);
  assert.deepEqual(error.fields?.map((f) => f.field), expected);
  assert.equal(await readProfile(dir), null);
  await assert.rejects(fs.stat(projectPaths(dir).profile), { code: 'ENOENT' });
});

test('writeProfile does not overwrite a valid profile when the new one is invalid', async (t) => {
  const dir = await makeDir(t);
  const saved = await writeProfile(dir, FULL, NOW);
  await assert.rejects(writeProfile(dir, { site_url: 'nope', brand: {} }, NOW), { code: 'INVALID_PROFILE' });
  assert.deepEqual(await readProfile(dir), saved);
});

test('each field rule is enforced', async (t) => {
  const dir = await makeDir(t);
  const base = { site_url: 'https://example.com', brand: { name: 'Example' } };
  const bad = {
    site_url: [{ ...base, site_url: 'example.com' }, { ...base, site_url: 'javascript:alert(1)' }, { ...base, site_url: 5 }, { brand: base.brand }],
    'brand.name': [{ ...base, brand: {} }, { ...base, brand: { name: 'x'.repeat(201) } }, { ...base, brand: { name: 'a\u0000b' } }, { ...base, brand: { name: 5 } }],
    brand: [{ ...base, brand: 'Example' }, { site_url: base.site_url }, { ...base, brand: null }],
    business_model: [{ ...base, business_model: 'ECOMMERCE' }, { ...base, business_model: 3 }],
    'markets[0].country': [{ ...base, markets: [{ country: 'U', languages: ['en'] }] }, { ...base, markets: [{ languages: ['en'] }] }],
    'markets[0].languages': [{ ...base, markets: [{ country: 'US' }] }, { ...base, markets: [{ country: 'US', languages: 'en' }] }],
    markets: [{ ...base, markets: 'US' }, { ...base, markets: Array.from({ length: 51 }, () => ({ country: 'US', languages: ['en'] })) }],
    competitors: [{ ...base, competitors: Array.from({ length: 21 }, (_, i) => `c${i}.com`) }],
    target_queries: [{ ...base, target_queries: 'x' }],
    'report.brand_name': [{ ...base, report: { brand_name: '' } }],
    report: [{ ...base, report: 'Acme' }],
    'report.extra': [{ ...base, report: { extra: 1 } }],
    profile: [null, 'text', [], 42],
  };
  for (const [field, inputs] of Object.entries(bad)) {
    for (const input of inputs) {
      const error = await rejection(writeProfile(dir, input, NOW));
      assert.equal(error.code, 'INVALID_PROFILE', `${field}: ${JSON.stringify(input)} was accepted`);
      assert.ok(error.fields?.some((f) => f.field === field), `${field} not named for ${JSON.stringify(input)}: ${error.message}`);
    }
  }
});

test('every business model in the contract is accepted', async (t) => {
  const dir = await makeDir(t);
  for (const model of ['b2b_saas', 'ecommerce', 'local_service', 'publisher', 'mobile_app', 'international', 'other']) {
    const saved = await writeProfile(dir, { site_url: 'https://example.com', brand: { name: 'E' }, business_model: model }, NOW);
    assert.equal(saved.business_model, model);
  }
});

test('readProfile reports a hand-edited file that is no longer valid, naming the bad fields', async (t) => {
  const dir = await makeDir(t);
  await writeProfile(dir, FULL, NOW);
  const file = projectPaths(dir).profile;
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));

  await fs.writeFile(file, JSON.stringify({ ...saved, site_url: 'nope', business_model: 'x' }));
  const error = await rejection(readProfile(dir));
  assert.equal(error.code, 'INVALID_PROFILE');
  assert.match(error.message, /site_url/);
  assert.match(error.message, /business_model/);
  assert.ok(error.message.includes(file));

  await fs.writeFile(file, '{ not json');
  assert.equal((await rejection(readProfile(dir))).code, 'INVALID_PROFILE');

  await fs.writeFile(file, JSON.stringify({ ...saved, updated_at: 'sometime' }));
  assert.match((await rejection(readProfile(dir))).message, /updated_at/);
});

test('readProfile and writeProfile reject a relative project directory', async () => {
  await assert.rejects(readProfile('relative'), { code: 'INVALID_PROJECT_DIR' });
  await assert.rejects(writeProfile('relative', FULL, NOW), { code: 'INVALID_PROJECT_DIR' });
});
