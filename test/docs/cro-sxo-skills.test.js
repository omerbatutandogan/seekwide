// What the cro and sxo commands tell Claude matches what the tools do (review of batch 2).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { allChecks } from '../../plugin/server/src/checks/registry.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (/** @type {string} */ file) => readFileSync(path.join(ROOT, file), 'utf8');

test('the lab checks are not tied to a key in words: the request goes out without one and Google refuses it today', () => {
  for (const file of ['plugin/skills/cro/SKILL.md', 'README.md', 'plugin/skills/all/SKILL.md']) {
    const text = read(file);
    assert.doesNotMatch(text, /With a (Google API )?key, (the|Lighthouse)[^.]*(lab test|PageSpeed Insights test)/, file);
    assert.match(text, /Google currently (refuses lab tests without|runs only with)/, file);
  }
});

test('every check id the sxo command passes to findings_query exists, since check_id matches exactly', () => {
  const ids = new Set(allChecks().map((check) => check.id));
  const text = read('plugin/skills/sxo/SKILL.md');
  const step = text.slice(text.indexOf('5. **Look closer.**'), text.indexOf('6. **Write the report.**'));
  const named = [...step.matchAll(/`(seo\.[a-z0-9_.*]+)`/g)].map((match) => match[1]);
  assert.ok(named.length >= 5);
  for (const id of named) assert.ok(ids.has(id), id);
});
