# Skill-flow evals

The unit and integration tests prove what the plugin's server does. They cannot prove what Claude does with it: whether it asks before it starts a dev server, stops the server it started, shows a diff before it edits a file, or calls a blocked crawl a clean site. This suite runs real Claude sessions with the plugin loaded, through [`claude plugin eval`](https://code.claude.com/docs/en/plugin-evals), and grades each one on facts it can observe: the tools called and their arguments, the order of the calls, the files in the workspace afterwards, and the words of the final answer. Four graders ask a small model (Haiku) to judge wording, each with written pass and fail conditions; the text graders next to them are coarse filters, and the judges carry the wording checks.

It costs tokens and is not part of CI. Run it after a change to a skill, a reference file or a tool description.

## The cases

| Case | Turn | What it checks |
|---|---|---|
| `basic-asks-first` | first | `/seekwide:basic` in a project folder: Claude names `npm run dev` and the `predev` and `postdev` scripts it also runs, asks, and starts and crawls nothing. |
| `basic-declined` | second, after a no | Nothing is started or crawled, no audit is saved, and another way is offered. |
| `basic-approved` | second, after a yes | The dev command is started in the background before the crawl, the local address is crawled and audited with `source_dir` and without Core Web Vitals, the server is stopped after the audit, files are named, the measured scores (SEO 81, links 95) are reported as measured, and Claude's own suggestions are labelled. |
| `basic-approved-crawl-fails` | second, after a yes | Nothing answers at the printed address: at most three crawls, no audit, the failure is said, and the server is still stopped. |
| `fix-shows-diffs` | first | `/seekwide:fix` on the Next.js TypeScript fixture with a saved run: a plan, diffs, a question, labelled suggestions, and no edit, write, commit or start. |
| `fix-applies-after-yes` | second, after a yes | The `metadata` export of the static pages and `generateMetadata` of the dynamic route are edited as the plan says, `src/app/sitemap.ts` is created, nothing is committed or started, and the same address is audited again with `verify_fixes`. |
| `blocked-crawl` | first | A crawl that robots.txt refuses is described as blocked, with the reason, and never as a site without problems. |
| `security-signs` | first | Security findings are worded as signs to check, not as a verdict. |

The task numbers in each case's `description` refer to the brief the suite was written for: 1 asking first, 2 starting and stopping, 3 the fix flow, 4 suggestions, 5 blocked crawls, 6 security wording.

## Running it

Once, to install Next.js for the fix cases in a cache outside the repository:

```bash
evals/setup.sh
```

Then, from the repository root:

```bash
claude plugin eval . --scaffold --allow-real-servers --allow-tools Bash Edit Write mcp__plugin_seekwide_seekwide "Read(/$PWD/references/**)" --ablation none --no-publish --runs 1 --judge-model haiku
```

- `--scaffold` runs each case's `scaffold.sh`, which copies a fixture into the empty workspace and starts the servers a case needs.
- `--allow-real-servers` starts the plugin's own MCP server; nothing is mocked.
- `--allow-tools`: Bash, Edit and Write must be available, or a case could not tell a Claude that obeys the skill from one that cannot act at all. `Read(/$PWD/references/**)` lets Claude read the plugin's reference files: `claude plugin eval` does not let the session read the plugin under test (so that it cannot read the graders), and the skills read `references/*.md`, which a normal session can. The graders under `evals/` stay unreadable.
- `--ablation none` skips the run without the plugin, which would only show that the cases need it.
- The cases ask for Sonnet themselves (`model: sonnet`); the judges use Haiku.

One run of all eight took about four minutes and cost 1.14 US dollars on 2026-11-12 (Sonnet for the sessions, Haiku for the judges); `fix-applies-after-yes` is the longest, because its scaffold starts Next.js.

## How the suite works around the eval sandbox

- **No command Claude runs may listen on a port.** The sandbox refuses `bind()` with "Operation not permitted" (tried on 2026-11-12 with Claude Code 2.1.322). A case that needs a server therefore starts it in its scaffold, which runs outside the sandbox: `lib/serve-static.mjs` for the HTML project, `next dev` for the Next.js one. Each stops by itself after 15 minutes (`SERVER_SECONDS`). In the basic cases the project's `dev` script (`fixtures/html-dev/dev-server.mjs`) only prints the address of that server and keeps running, so the flow Claude follows is the real one: ask, start the command in the background, read the address from its output, crawl, audit, stop it. In `fix-applies-after-yes` the user says the server is already running, which the skill handles by starting nothing.
- **There is no simulated user.** A second turn is a case whose `history_file` is the recorded first turn and whose prompt is the answer. The recordings are in `fixtures/recorded/`, made from real runs of the first-turn cases. A recording names the workspace and plugin folder of the run it came from, so they are kept as placeholders, and the scaffold writes the case's `history.jsonl` with the paths of the current run.
- **No grader runs a command after the case.** Whether the server was stopped is graded from the calls: `TaskStop` was called, and after an audit or crawl had started (`tool_order` compares the first call of each, so it cannot tell a stop between two audits from one after the last). Whether a file was edited is graded from its content after the run (`target: {source: file}`), and whether nothing was written from the absence of Edit, Write and the shell commands that write files.
- **A shell command is matched in its JSON form**, where a quote is `\"`, so the patterns read the command as escaped JSON text and are not stopped by a quoted path.

## Recording the first turns

The follow-up cases replay a recorded first turn. When a skill or the fixture of a first-turn case changes, record it again:

```bash
claude plugin eval . --case basic-asks-first --keep-temp --scaffold --allow-real-servers --allow-tools Bash Edit Write mcp__plugin_seekwide_seekwide "Read(/$PWD/references/**)" --ablation none --no-publish --runs 1
```

```bash
node evals/lib/record-history.mjs /tmp/e-XXXXXX basic-asks-first
```

and the same with `fix-shows-diffs`. `/tmp/e-XXXXXX` is the folder the run printed after "kept temp".

A recording holds the skill text and the reference files as they were when it was made, and a follow-up case replays them: it tests the recorded text, not the current one. So each follow-up scaffold first runs `lib/check-recording.mjs`, which compares the skill and every plugin file the recorded turn read with the files on disk, and the case fails with a message to record again when one changed:

```bash
node evals/lib/check-recording.mjs basic-asks-first
```
 The script keeps the messages, tool calls and tool results of the turn and drops what only records how the turn was sent (request blobs, prompt snapshots, the sandbox rules of that run) and what names the account (its e-mail address and organization); it replaces the home folder and refuses a recording that still names the user. Check that the recorded turn ends with Claude's question and that it changed nothing before you keep it.

## Files

- `<case>/case.yaml`: the prompt, the limits and the graders. `<case>/scaffold.sh`: what the workspace holds.
- `lib/check-recording.mjs`: whether a recording still matches the plugin's text.
- `lib/scaffold.sh`: the steps the scaffolds share. `lib/serve-static.mjs`, `lib/timed.mjs`: the servers outside the sandbox; a scaffold stops the server its suite left on a fixed port in an earlier run (`.servers/`, not committed), and nothing else. `lib/record-history.mjs`: a first-turn session to a recording.
- `fixtures/recorded`: the recorded first turns of `basic-asks-first` and `fix-shows-diffs` (Sonnet, 2026-11-12).
- `fixtures/html-dev`: the `package.json` and dev script added to `fixtures/html-site`. `fixtures/blocked-site`: a site whose robots.txt refuses every crawler. `fixtures/fix-base`: the saved repo-mode run of `fixtures/next-ts` that `/seekwide:fix` works from, made with Next.js 16.4.6 at `http://localhost:47320`.
- `results/` (not committed): `aggregate-result.json` and `report.html` of each run.
