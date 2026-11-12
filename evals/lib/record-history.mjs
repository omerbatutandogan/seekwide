#!/usr/bin/env node
// Turn the session of a first-turn case into a recorded first turn that
// follow-up cases replay. Run the first-turn case with --keep-temp, then:
//
//   node evals/lib/record-history.mjs <kept-temp-folder> <name>
//
// It writes evals/fixtures/recorded/<name>.jsonl. A follow-up case's scaffold
// fills in its placeholders (write_history <name> in lib/scaffold.sh).
//
// What is changed:
// - The workspace and the plugin folder of the recorded run become
//   placeholders, because the follow-up run has its own.
// - Entries that only record how the turn was sent (request blobs and shapes,
//   prompt snapshots, the sandbox rules of that run) and entries about the
//   account (its e-mail address and organization) are dropped; the entries
//   that pointed to a dropped one point to its parent instead. The messages,
//   tool calls and tool results of the turn are kept as they were.
// - Any other e-mail address and the home folder of the person who recorded
//   it are replaced with neutral values, and the recording is refused if their
//   user name is still in it.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [kept, name] = process.argv.slice(2);
if (!kept || !name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('Usage: node evals/lib/record-history.mjs <kept-temp-folder> <name>');
  process.exit(2);
}
const evalsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = path.dirname(evalsDir);
const root = path.resolve(kept);
const projects = path.join(root, 'config', 'projects');
const folder = readdirSync(projects).find((entry) => entry.endsWith('-home-cwd'));
if (!folder) throw new Error(`No session of the workspace in ${projects}`);
const sessions = readdirSync(path.join(projects, folder)).filter((entry) => entry.endsWith('.jsonl'));
if (sessions.length !== 1) throw new Error(`Expected one session in ${path.join(projects, folder)}, found ${sessions.length}`);

const DROPPED_TYPES = new Set(['api-request-blob', 'api-request-shape', 'api-request']);
const DROPPED_ATTACHMENTS = new Set(['prompt_snapshot', 'sandbox_instructions', 'session_context', 'credential_org', 'remote_session_change']);

/** @type {Record<string, any>[]} */
const entries = readFileSync(path.join(projects, folder, sessions[0]), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const isDropped = (/** @type {Record<string, any>} */ entry) => DROPPED_TYPES.has(entry.type) || (entry.type === 'attachment' && DROPPED_ATTACHMENTS.has(entry.attachment?.type));
/** The parent each dropped entry had, so that its children can point past it. @type {Map<string, string|null>} */
const parentOf = new Map(entries.filter((entry) => isDropped(entry) && entry.uuid).map((entry) => [entry.uuid, entry.parentUuid ?? null]));
const lift = (/** @type {string|null|undefined} */ uuid) => {
  let current = uuid;
  while (current && parentOf.has(current)) current = parentOf.get(current);
  return current ?? null;
};
const remaining = entries.filter((entry) => !isDropped(entry)).map((entry) => ('parentUuid' in entry ? { ...entry, parentUuid: lift(entry.parentUuid) } : entry));

const slug = (/** @type {string} */ value) => value.replace(/[^A-Za-z0-9]/g, '-');
// The kept folder is /private/tmp/e-XXXX on macOS, also written as /tmp/e-XXXX.
const short = root.replace(/^\/private\/tmp\//, '/tmp/');
const home = os.homedir();
const user = os.userInfo().username;
let text = `${remaining.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
for (const [from, to] of [
  [root, '__EVAL_ROOT__'], [short, '__EVAL_ROOT__'], [slug(root), '__EVAL_SLUG__'], [slug(short), '__EVAL_SLUG__'],
  [pluginRoot, '__PLUGIN_ROOT__'], [slug(pluginRoot), '__PLUGIN_SLUG__'],
  [home, '/Users/user'], [slug(home), '-Users-user'],
]) {
  text = text.split(from).join(to);
}
text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'user@example.com');
text = text.replace(/"organizationUuid":"[^"]*"/g, '"organizationUuid":"00000000-0000-0000-0000-000000000000"');
if (text.includes(home) || new RegExp(`\\b${user}\\b`).test(text)) {
  throw new Error(`The recording still names the user ${user} or the home folder; remove it before keeping the recording.`);
}
const target = path.join(evalsDir, 'fixtures', 'recorded', `${name}.jsonl`);
writeFileSync(target, text);
console.log(`Wrote ${path.relative(pluginRoot, target)}: ${remaining.length} of ${entries.length} entries, ${Buffer.byteLength(text)} bytes.`);
