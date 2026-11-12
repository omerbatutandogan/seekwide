# Contributing

Thanks for helping. Seekwide's value is that its findings can be trusted, so contributions are judged mostly on that.

## Before you start

- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the modules fit together and the coding and testing rules.
- Read [docs/CHECKS-SPEC.md](docs/CHECKS-SPEC.md) before touching a check.

## Reporting a wrong finding

A finding that is wrong on your site is the most useful report you can send. Open an issue with:

- the check id (for example `seo.canonical.multiple`),
- the URL, or the HTML and response headers of the page,
- what Seekwide reported and why it is wrong.

A confirmed false finding gets a regression test from your example.

## Adding or changing a check

1. Describe the rule in `docs/CHECKS-SPEC.md` first: what a unit is, when it fails, severity, weight, confidence, what it needs, and the official documentation it rests on.
2. Implement it in `server/src/checks/<module>/`. A check is a pure function of the crawl data: no network, no clock, no randomness.
3. Add a test for a failing case, a passing case, and a case the check does not apply to.
4. Set `last_verified` to the date you read the documentation.
5. Run `node scripts/gen-checks-doc.js` to update `docs/checks.md`.
6. Bump `RULES_VERSION` in `server/src/config.js` when an existing check changes what it reports.

Rules of thumb without an official source can only be `info` checks with weight 0.

## Ground rules

- Scripted checks decide scores. Model judgment never does.
- The crawler stays polite and honest: it obeys robots.txt, identifies itself, and never tries to get past a block.
- No new runtime dependencies without a discussion first. The plugin installs on every user's machine.
- No stubs, `TODO` comments or skipped tests in a pull request.
- Tests must not send requests outside `127.0.0.1`.

## Checks to run

One command runs every check CI runs, in order, and stops at the first that fails:

```bash
npm run check
```

It runs the tests, the strict type check, the check that `docs/checks.md` matches the code, the plugin directory rules, `claude plugin validate` and `npm audit`. It needs Claude Code on your `PATH` and a connection to the npm registry. The same checks, one by one:

```bash
npm test
```

The code is plain JavaScript with JSDoc types, checked in strict mode. TypeScript is not a dependency of the plugin, so install it without saving (`npm run check` does this for you):

```bash
npm install --no-save --ignore-scripts typescript@7.0.2 @types/node@22.20.5
```

```bash
npx tsc -p jsconfig.json
```

```bash
node scripts/gen-checks-doc.js --check
```

```bash
node scripts/check-directory-rules.js
```

```bash
claude plugin validate . --strict --profile directory
```

```bash
npm audit --omit=dev
```

The TypeScript version is pinned in three places, which change together: here, `.github/workflows/ci.yml` and `scripts/check.js` (which fails when it and the workflow differ).

## Evals

The skill-flow evals in `evals/` run real Claude sessions and cost tokens; see [evals/README.md](evals/README.md). **Review a pull request's changes under `evals/` before you run them:** a case's `scaffold.sh` runs as a bash script on your machine, outside the eval sandbox, and its recorded transcripts are replayed into a session that may use Bash, Edit and Write.
