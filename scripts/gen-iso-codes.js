#!/usr/bin/env node
// Write plugin/server/data/iso-codes.json, the codes an hreflang value may use
// (Google: ISO 639-1 languages, ISO 15924 scripts, ISO 3166-1 alpha-2
// regions), from the JSON files of Debian's iso-codes package, which follows
// the ISO maintenance agencies. Development tool: the plugin never runs it.
//
//   node scripts/gen-iso-codes.js [/usr/share/iso-codes/json] [package version]

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] ?? '/usr/share/iso-codes/json';
const version = process.argv[3] ?? 'unknown';
/** @param {string} file @param {string} key @returns {Record<string, string>[]} */
const read = (file, key) => JSON.parse(readFileSync(path.join(dir, file), 'utf8'))[key];

const languages = read('iso_639-2.json', '639-2').flatMap((entry) => (entry.alpha_2 ? [entry.alpha_2.toLowerCase()] : []));
const scripts = read('iso_15924.json', '15924').map((entry) => entry.alpha_4)
  // Codes of the private-use range (Qaaa-Qabx) and the special codes for no or unknown script are not scripts of content.
  .filter((code) => !/^Qa[a-b][a-x]$/.test(code) && !['Zxxx', 'Zyyy', 'Zzzz', 'Zinh', 'Zmth', 'Zsye', 'Zsym'].includes(code));
const regions = read('iso_3166-1.json', '3166-1').map((entry) => entry.alpha_2.toUpperCase());

const out = {
  source: `Debian iso-codes ${version}: ISO 639-1 (alpha-2 codes of ISO 639-2), ISO 15924, ISO 3166-1 alpha-2`,
  languages: [...new Set(languages)].sort().join(' '),
  scripts: [...new Set(scripts)].sort().join(' '),
  regions: [...new Set(regions)].sort().join(' '),
};
const target = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugin', 'server', 'data', 'iso-codes.json');
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), target)}: ${languages.length} languages, ${scripts.length} scripts, ${regions.length} regions`);
