// Arguments built to make the validator's answer huge or to crash it.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_PROBLEMS, validate } from '../../server/src/mcp/schema.js';

const SCHEMA = {
  type: 'object',
  properties: { ids: { type: 'array', items: { type: 'string', maxLength: 10 }, maxItems: 5 } },
  additionalProperties: false,
};

test('hundreds of thousands of unknown keys give a short answer', () => {
  const args = Object.fromEntries(Array.from({ length: 300_000 }, (_, i) => [`key${i}${'x'.repeat(30)}`, 1]));
  const problems = validate(SCHEMA, args);
  assert.equal(problems.length, MAX_PROBLEMS);
  assert.ok(problems.join('; ').length < 2000);
});

test('an array of a million items is refused for its length, without a stack overflow', () => {
  const problems = validate(SCHEMA, { ids: Array.from({ length: 1_000_000 }, () => 1) });
  assert.deepEqual(problems, ['ids must have at most 5 items (got 1000000)']);
});

test('a long unknown key is named in part', () => {
  const [problem] = validate(SCHEMA, { ['k'.repeat(5000)]: 1 });
  assert.ok(problem.length < 200, problem);
});

test('a few problems are all reported, as before', () => {
  assert.deepEqual(validate(SCHEMA, { a: 1, ids: ['ok', 7] }), ['a is not an accepted argument', 'ids[1] must be a string']);
});
