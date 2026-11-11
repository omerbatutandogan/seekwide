import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertSupportedSchema, validate } from '../../server/src/mcp/schema.js';

describe('validate', () => {
  it('checks type, including integer and type lists', () => {
    assert.deepEqual(validate({ type: 'string' }, 'x'), []);
    assert.deepEqual(validate({ type: 'string' }, 1, 'url'), ['url must be a string']);
    assert.deepEqual(validate({ type: 'integer' }, 3), []);
    assert.deepEqual(validate({ type: 'integer' }, 3.5, 'n'), ['n must be an integer']);
    assert.deepEqual(validate({ type: 'number' }, 3.5), []);
    assert.deepEqual(validate({ type: 'number' }, Number.NaN, 'n'), ['n must be a number']);
    assert.deepEqual(validate({ type: 'boolean' }, 'true', 'b'), ['b must be a boolean']);
    assert.deepEqual(validate({ type: 'object' }, [], ''), ['arguments must be an object']);
    assert.deepEqual(validate({ type: 'array' }, {}, 'a'), ['a must be an array']);
    assert.deepEqual(validate({ type: ['string', 'null'] }, null), []);
    assert.deepEqual(validate({ type: 'null' }, 0, 'z'), ['z must be null']);
  });

  it('checks properties and required', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };
    assert.deepEqual(validate(schema, { a: 'x' }), []);
    assert.deepEqual(validate(schema, {}), ['a is required']);
    assert.deepEqual(validate(schema, { a: 1 }), ['a must be a string']);
  });

  it('allows unknown properties unless additionalProperties is false', () => {
    const open = { type: 'object', properties: { a: { type: 'string' } } };
    assert.deepEqual(validate(open, { b: 1 }), []);
    assert.deepEqual(validate({ ...open, additionalProperties: false }, { b: 1 }), ['b is not an accepted argument']);
    assert.deepEqual(validate({ ...open, additionalProperties: true }, { b: 1 }), []);
  });

  it('checks enum', () => {
    assert.deepEqual(validate({ enum: ['seo', 'links'] }, 'seo'), []);
    assert.deepEqual(validate({ enum: ['seo', 'links'] }, 'ads', 'module'), ['module must be one of "seo", "links"']);
  });

  it('checks minimum and maximum', () => {
    const schema = { type: 'integer', minimum: 1, maximum: 500 };
    assert.deepEqual(validate(schema, 1), []);
    assert.deepEqual(validate(schema, 500), []);
    assert.deepEqual(validate(schema, 0, 'max_pages'), ['max_pages must be at least 1']);
    assert.deepEqual(validate(schema, 501, 'max_pages'), ['max_pages must be at most 500']);
  });

  it('checks maxLength in code points', () => {
    assert.deepEqual(validate({ type: 'string', maxLength: 2 }, '😀😀'), []);
    assert.deepEqual(validate({ type: 'string', maxLength: 2 }, 'abc', 's'), ['s must be at most 2 characters (got 3)']);
  });

  it('checks items and maxItems with indexed paths', () => {
    const schema = { type: 'array', maxItems: 2, items: { type: 'string', enum: ['a', 'b'] } };
    assert.deepEqual(validate(schema, ['a', 'b']), []);
    assert.deepEqual(validate(schema, ['a', 'b', 'a'], 'list'), ['list must have at most 2 items (got 3)']);
    assert.deepEqual(validate(schema, ['a', 'c'], 'list'), ['list[1] must be one of "a", "b"']);
  });

  it('reports nested problems with their path', () => {
    const schema = {
      type: 'object',
      properties: { recs: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } } },
    };
    assert.deepEqual(validate(schema, { recs: [{}] }), ['recs[0].title is required']);
  });
});

describe('assertSupportedSchema', () => {
  it('accepts the supported subset and annotations', () => {
    assert.doesNotThrow(() =>
      assertSupportedSchema({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        description: 'x',
        properties: { a: { type: 'integer', minimum: 0, maximum: 5, default: 1, title: 'A' }, b: { type: 'array', items: { enum: [1] }, maxItems: 3 } },
        required: ['a'],
        additionalProperties: false,
      }),
    );
  });

  it('rejects unsupported keywords, types and values', () => {
    assert.throws(() => assertSupportedSchema({ type: 'string', pattern: '^a' }), /unsupported keyword "pattern"/);
    assert.throws(() => assertSupportedSchema({ type: 'object', properties: { a: { oneOf: [] } } }), /properties\.a uses unsupported keyword "oneOf"/);
    assert.throws(() => assertSupportedSchema({ type: 'date' }), /unknown type/);
    assert.throws(() => assertSupportedSchema({ type: 'object', additionalProperties: {} }), /true or false/);
    assert.throws(() => assertSupportedSchema({ maximum: '5' }), /must be a number/);
    assert.throws(() => assertSupportedSchema({ required: 'a' }), /must be an array/);
    assert.throws(() => assertSupportedSchema(null), /must be an object/);
  });
});
