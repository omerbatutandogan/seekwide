# Skill-flow evals

The unit and integration tests prove what the plugin's server does. They cannot prove what Claude does with it: whether it asks before it starts a dev server, stops the server it started, shows a diff before it edits a file, or calls a blocked crawl a clean site. This suite runs real Claude sessions with the plugin loaded, through [`claude plugin eval`](https://code.claude.com/docs/en/plugin-evals), and grades each one on facts it can observe: the tools called and their arguments, the order of the calls, the files in the workspace afterwards, and the words of the final answer. Twelve graders ask a small model (Haiku) to judge wording, each with written pass and fail conditions; the text graders next to them are coarse filters, and the judges carry the wording checks.

It costs tokens and is not part of CI. Run it after a change to a skill, a reference file or a tool description.

**Review a pull request's changes under `evals/` before you run the suite.** Each case's `scaffold.sh` runs as a bash script on your machine, outside the eval sandbox, and the recorded transcripts in `evals/fixtures/recorded/` are replayed as history into a session that may use Bash, Edit and Write. A change there can run anything with your permissions, so read it as you would read a script someone sends you.

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
| `ai-readiness-wording` | first | `/seekwide:ai` reports counts of what robots.txt and the pages allow, never a score or a promise of visibility in AI answers, and never presents llms.txt as something that helps. |
| `ai-blocked-bot-not-verdict` | first | An AI crawler that robots.txt disallows is reported as what the file says, to check against the owner's intent, never as a verdict that the crawler is refused in practice or that the site is missing from an AI product. |
| `cro-suggestions-labelled` | first | `/seekwide:cro` on a site whose contact form has ordinary mistakes, with a request for A/B test ideas: the findings are reported as the checks give them, two A/B test ideas are given, each as a hypothesis or suggestion, the call-to-action wording is labelled as a suggestion and nothing promises conversions, the consent-tool observation is mentioned and is never a legal verdict, and no form is submitted or its action address requested. |
| `sxo-no-serp-claims` | first | `/seekwide:sxo` with a question about the title Google shows: no search result page or search engine is requested, nothing is claimed about rankings or about what Google shows, and the ad metrics observation and the informational title check are not presented as problems to fix. |

The task numbers in each case's `description` refer to the brief the suite was written for: 1 asking first, 2 starting and stopping, 3 the fix flow, 4 suggestions, 5 blocked crawls, 6 security wording. The two `ai-` cases are the exit criteria of the ai module (0.2.0); `cro-suggestions-labelled` and `sxo-no-serp-claims` check the wording the cro and sxo skills promise.

## Running it

Once, to install Next.js for the fix cases in a cache outside the repository:

```bash
evals/setup.sh
```

Then, from the root of the repository (the script finds the repository from its own path, so from another folder give its full path instead, `/path/to/seekwide/evals/run.sh`):

```bash
evals/run.sh                                  # every case
evals/run.sh blocked-crawl security-signs     # only these cases
evals/run.sh --keep-temp basic-asks-first
```

Without case names it runs every case; with names, only those. `--keep-temp` is passed on to `claude plugin eval`, which then keeps each case's workspace (the folder the scaffold filled and the session ran in) instead of deleting it, and prints where it is; that is how a first turn is recorded (see [Recording the first turns](#recording-the-first-turns)). Only one run can be in progress: a second one stops with a message while the first is alive. A run killed so hard that it could not clean up (SIGKILL) does not block the next one, which removes what it left.

The plugin is the `plugin/` folder, which is all that ships; the evals stay at the root of the repository, next to it, so that they are not installed with the plugin. `claude plugin eval` reads cases only from a folder inside the plugin (`--eval-dir ../evals` is refused with "--eval-dir must stay inside the plugin root"), and since 2026-11-14 it also refuses a link there ("an eval-directory link that points outside the plugin"). So `run.sh`:

1. copies the cases it runs, `lib/` and `fixtures/` to `plugin/evals`, which git ignores and the directory rules do not count, and writes the repository's path to `plugin/evals/.repo-dir`. A scaffold run from the copy reads the repository from that file (its own parent is `plugin/`, not the repository), so the cases that use the repository's fixtures and the plugin work; a scaffold run from `evals/` itself still finds the repository as its parent. The pid files of the servers (`.servers/`) and the path `setup.sh` wrote (`.deps-dir`) stay in `evals/`;
2. runs, from the repository root:

   ```bash
   claude plugin eval plugin --trust-plugin --scaffold --allow-real-servers --allow-tools Bash Edit Write mcp__plugin_seekwide_seekwide "Read(/<repository>/plugin/references/**)" --ablation none --no-publish --runs 1 --judge-model haiku --output-dir evals/results/<UTC timestamp>
   ```

   and writes what it prints to `run.log` in that results folder, next to `aggregate-result.json` and `report.html`;
3. removes `plugin/evals` when it ends, also when the run fails or is interrupted. A copy a killed run left behind is removed at the start of the next run.

Each flag of that call:

- `plugin`: the target, the plugin folder; its eval suite is `plugin/evals`, the copy.
- `--trust-plugin`: `claude plugin eval` asks before it reads an eval suite in a plugin folder it has not seen; the flag says that you trust the plugin and its eval suite, which you should only do after reading the cases (see the warning at the top).
- `--scaffold` runs each case's `scaffold.sh`, which copies a fixture into the empty workspace and starts the servers a case needs.
- `--allow-real-servers` starts the plugin's own MCP server. Under the CLI's default `--mocks record`, a server without a recorded stand-in in `<eval dir>/mocks/` is not started otherwise, and this suite has no stand-ins, so nothing is mocked.
- `--allow-tools`: Bash, Edit and Write must be available, or a case could not tell a Claude that obeys the skill from one that cannot act at all. `Read(/<repository>/plugin/references/**)` lets Claude read the plugin's reference files: `claude plugin eval` does not let the session read the plugin under test (so that it cannot read the graders), and the skills read the plugin's `references/*.md`, which a normal session can.
- `--ablation none` skips the run without the plugin, which would only show that the cases need it.
- `--no-publish` keeps the HTML report on your machine; without it the CLI also publishes the report to claude.ai when the account supports it.
- `--runs 1` runs each case once instead of the CLI's default of three runs per case (a case can set its own `runs`), which keeps the cost of a run of the suite near the figures below.
- `--judge-model haiku` names the model of the LLM graders. Haiku is also the CLI's default; it is written out so that a change of the default does not change the judges silently. The cases ask for Sonnet themselves (`model: sonnet`).
- `--keep-temp` is passed only when you give it to `run.sh` (above).
- `--output-dir evals/results/<UTC timestamp>` writes `aggregate-result.json` and `report.html` there, at the root of the repository, instead of inside the copy that `run.sh` removes at the end.

The scaffolds' static servers stop by themselves after 25 minutes; one left on a case's port by an earlier run is stopped by the next run of that case, and anything else on the port makes that case fail at its scaffold.

### Last run

On 2026-11-15 with Claude Code 2.1.322 (`claude --version`), through `evals/run.sh`, each case once: all twelve passed with a score of 1.00. The recording of `basic-asks-first` was out of date (`references/repo-mode.md` had changed), so that case ran first with `--keep-temp`, its turn was recorded again from that run, and the three follow-up cases ran after it.

After a review found that `cro-suggestions-labelled` could pass an answer without A/B ideas or without the consent observation, its graders were made stricter (two A/B ideas, each presented as a hypothesis or suggestion; the consent observation mentioned without a legal verdict), and that case ran once more the same day, on its own: 1.00, 0.17 USD. The table gives that run for it.

| Case | Score | Cost (USD) |
|---|---|---|
| `basic-asks-first` | 1.00 | 0.12 |
| `basic-declined` | 1.00 | 0.09 |
| `basic-approved` | 1.00 | 0.19 |
| `basic-approved-crawl-fails` | 1.00 | 0.18 |
| `fix-shows-diffs` | 1.00 | 0.17 |
| `fix-applies-after-yes` | 1.00 | 0.23 |
| `blocked-crawl` | 1.00 | 0.13 |
| `security-signs` | 1.00 | 0.15 |
| `ai-readiness-wording` | 1.00 | 0.15 |
| `ai-blocked-bot-not-verdict` | 1.00 | 0.14 |
| `cro-suggestions-labelled` | 1.00 | 0.17 |
| `sxo-no-serp-claims` | 1.00 | 0.17 |

The CLI printed 1.89 US dollars for the first three runs (0.12, 1.43 and 0.34; Sonnet for the sessions, Haiku for the judges); the run of the nine older cases took about five minutes, `fix-applies-after-yes` the longest, because its scaffold starts Next.js. The second run of `cro-suggestions-labelled` cost 0.17 more and took 48 seconds.

## How the suite works around the eval sandbox

- **No command Claude runs may listen on a port.** The sandbox refuses `bind()` with "Operation not permitted" (tried on 2026-11-12 with Claude Code 2.1.322). A case that needs a server therefore starts it in its scaffold, which runs outside the sandbox: `lib/serve-static.mjs` for the HTML project, `next dev` for the Next.js one. Each stops by itself after 25 minutes (`SERVER_SECONDS`, 1500 seconds, longer than the longest case timeout) and listens on 127.0.0.1 only. In the basic cases the project's `dev` script (`fixtures/html-dev/dev-server.mjs`) only prints the address of that server and keeps running, so the flow Claude follows is the real one: ask, start the command in the background, read the address from its output, crawl, audit, stop it. In `fix-applies-after-yes` the user says the server is already running, which the skill handles by starting nothing.
- **There is no simulated user.** A second turn is a case whose `history_file` is the recorded first turn and whose prompt is the answer. The recordings are in `fixtures/recorded/`, made from real runs of the first-turn cases. A recording names the workspace and plugin folder of the run it came from, so they are kept as placeholders, and the scaffold writes the case's `history.jsonl` with the paths of the current run.
- **No grader runs a command after the case.** Whether the server was stopped is graded from the calls: `TaskStop` was called, and after an audit or crawl had started (`tool_order` compares the first call of each, so it cannot tell a stop between two audits from one after the last). Whether a file was edited is graded from its content after the run (`target: {source: file}`), and whether nothing was written from the absence of Edit, Write and the shell commands that write files.
- **A shell command is matched in its JSON form**, where a quote is `\"`, so the patterns read the command as escaped JSON text and are not stopped by a quoted path.

## Recording the first turns

The follow-up cases replay a recorded first turn. When a skill or the fixture of a first-turn case changes, record it again:

```bash
evals/run.sh --keep-temp basic-asks-first
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
- `fixtures/recorded`: the recorded first turns of `basic-asks-first` (Sonnet, recorded again on 2026-11-15 after `references/repo-mode.md` changed) and `fix-shows-diffs` (Sonnet, 2026-11-12).
- `run.sh`: runs the suite from a copy inside the plugin ([Running it](#running-it)). `setup.sh`: installs Next.js for the fix cases.
- `fixtures/ai-site`: a made-up bakery whose robots.txt blocks some AI crawlers, with a `nosnippet` page and an `llms.txt`, for the two `ai-` cases.
- `fixtures/cro-site`: a made-up plumbing firm whose contact form has an unnamed field, an undefined autocomplete value, email and phone fields typed as text and blocked pasting, with a `tel:` link with letters and an inline IAB TCF stub (no third-party script), for `cro-suggestions-labelled`. `fixtures/sxo-site`: a made-up walking tour company with a half-empty title, a title with last year's year, two pages with the same title and a viewport that stops zooming, for `sxo-no-serp-claims`.
- `fixtures/html-dev`: the `package.json` and dev script added to `fixtures/html-site`. `fixtures/blocked-site`: a site whose robots.txt refuses every crawler. `fixtures/fix-base`: the saved repo-mode run of `fixtures/next-ts` that `/seekwide:fix` works from, made with Next.js 16.4.6 at `http://localhost:47320`.
- `results/` (not committed): `aggregate-result.json`, `report.html` and `run.log` of each run.
