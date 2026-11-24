#!/usr/bin/env node
// Write plugin/server/data/local-business-types.json: schema.org's
// LocalBusiness and every type below it, from the types CSV of a schema.org
// release. Google's LocalBusiness rules apply to these types. Development
// tool: the plugin never runs it.
//
//   curl -fsSL -o /tmp/types.csv https://raw.githubusercontent.com/schemaorg/schemaorg/main/data/releases/30.1/schemaorg-current-https-types.csv
//   node scripts/gen-local-business-types.js /tmp/types.csv 30.1

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [file, version = 'unknown'] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node scripts/gen-local-business-types.js <schemaorg-current-https-types.csv> <release>');
  process.exit(2);
}

/**
 * The rows of a CSV file with quoted fields ("" inside a field is a quote).
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; } else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (char !== '\r') field += char;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const [header, ...rows] = parseCsv(readFileSync(file, 'utf8'));
const at = (/** @type {string} */ name) => header.indexOf(name);
const [ID, LABEL, PARENTS] = [at('id'), at('label'), at('subTypeOf')];
/** @type {Map<string, string[]>} */
const children = new Map();
const labels = new Map(rows.map((row) => [row[ID], row[LABEL]]));
for (const row of rows) {
  for (const parent of row[PARENTS].split(',').map((value) => value.trim()).filter(Boolean)) {
    children.set(parent, [...(children.get(parent) ?? []), row[ID]]);
  }
}
const ROOT = 'https://schema.org/LocalBusiness';
const found = new Set([ROOT]);
const stack = [ROOT];
while (stack.length > 0) {
  for (const child of children.get(/** @type {string} */ (stack.pop())) ?? []) {
    if (!found.has(child)) { found.add(child); stack.push(child); }
  }
}
const types = [...found].map((id) => labels.get(id)).filter((label) => typeof label === 'string').sort();
const target = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugin', 'server', 'data', 'local-business-types.json');
writeFileSync(target, `${JSON.stringify({ source: `schema.org ${version}: LocalBusiness and its subtypes`, types: types.join(' ') }, null, 2)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), target)}: ${types.length} types`);
