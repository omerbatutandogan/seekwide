#!/usr/bin/env node
// Say whether a recorded first turn still matches the plugin. A follow-up case
// replays the skill text and the reference files exactly as they were when the
// turn was recorded, so after a change to them it would test the old text.
//
// Usage: node evals/lib/check-recording.mjs <name>
// Exits 1 and names each file whose text differs from the recording.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [name] = process.argv.slice(2);
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('Usage: node evals/lib/check-recording.mjs <name>');
  process.exit(2);
}
const evalsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = path.dirname(evalsDir);
const PLACEHOLDER = '__PLUGIN_ROOT__';

/** @type {Record<string, any>[]} */
const entries = readFileSync(path.join(evalsDir, 'fixtures', 'recorded', `${name}.jsonl`), 'utf8')
  .split('\n').filter(Boolean).map((line) => JSON.parse(line));
const items = entries.flatMap((entry) => (Array.isArray(entry.message?.content) ? entry.message.content : []));

/** @type {{file: string, recorded: string, current: string}[]} */
const compared = [];
const normalize = (/** @type {string} */ text) => text.replace(/\r\n/g, '\n').trimEnd();

// Skills: the text Claude Code sent for the skill, against SKILL.md without its front matter.
for (const item of items) {
  const match = item.type === 'text' ? /^Base directory for this skill: __PLUGIN_ROOT__\/(skills\/[a-z0-9-]+)\n\n/.exec(item.text) : null;
  if (!match) continue;
  const file = `${match[1]}/SKILL.md`;
  const source = readFileSync(path.join(pluginRoot, file), 'utf8').replace(/^---\n[\s\S]*?\n---\n+/, '');
  // `$ARGUMENTS` was replaced with what the user typed, so that line is left out on both sides.
  const withoutArguments = (/** @type {string} */ text) => text.split('\n').filter((line) => !line.startsWith('Arguments: `')).join('\n');
  compared.push({
    file,
    recorded: normalize(withoutArguments(item.text.slice(match[0].length))),
    current: normalize(withoutArguments(source.split('${CLAUDE_PLUGIN_ROOT}').join(PLACEHOLDER))),
  });
}

// Reference files Claude read: the Read result, line numbers removed, against the file.
const reads = new Map(items.filter((item) => item.type === 'tool_use' && item.name === 'Read').map((item) => [item.id, item.input.file_path]));
for (const item of items) {
  if (item.type !== 'tool_result' || !reads.has(item.tool_use_id)) continue;
  const target = String(reads.get(item.tool_use_id));
  if (!target.startsWith(`${PLACEHOLDER}/`)) continue;
  const file = target.slice(PLACEHOLDER.length + 1);
  const text = typeof item.content === 'string' ? item.content : item.content.map((part) => part.text ?? '').join('');
  const recorded = text.split('\n').map((line) => line.replace(/^\s*\d+\t/, '')).join('\n');
  const absolute = path.join(pluginRoot, file);
  compared.push({ file, recorded: normalize(recorded), current: existsSync(absolute) ? normalize(readFileSync(absolute, 'utf8')) : '' });
}

const stale = compared.filter((entry) => entry.recorded !== entry.current).map((entry) => entry.file);
if (compared.length === 0) {
  console.error(`The recording ${name} holds no skill text or plugin file to compare.`);
  process.exit(1);
}
if (stale.length > 0) {
  console.error(`The recording ${name} is out of date: ${[...new Set(stale)].join(', ')} changed since it was recorded. Record it again (evals/README.md, "Recording the first turns").`);
  process.exit(1);
}
console.log(`The recording ${name} matches ${compared.map((entry) => entry.file).join(', ')}.`);
