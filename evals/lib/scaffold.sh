# Steps the case scaffolds share. A case's scaffold.sh sources this file; it
# runs in the empty workspace (its working directory), outside the sandbox,
# before Claude starts, and only with `claude plugin eval --scaffold`.
#
# The sandbox does not let a command Claude runs listen on a port (tried: the
# bind fails with "Operation not permitted"), so a server a case needs is
# started here, outside the sandbox, and stops by itself after
# SERVER_SECONDS. Claude's own dev command only prints that server's address.

set -euo pipefail

case_dir="$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)"
evals_dir="$(cd "$case_dir/.." && pwd)"
repo_dir="$(cd "$evals_dir/.." && pwd)"
lib_dir="$evals_dir/lib"
# Longer than the longest case timeout (1200 seconds), so no server expires during a run.
SERVER_SECONDS=1500
# The eval sets TMPDIR for the scaffold; a scaffold run by hand may not have it.
TMPDIR="${TMPDIR:-/tmp}"

fail() {
  echo "scaffold: $*" >&2
  exit 1
}

wait_for_file() {
  for _ in $(seq 1 100); do
    [ -s "$1" ] && return 0
    sleep 0.1
  done
  return 1
}

# Stop the server a scaffold of this suite left on <port> in an earlier run, if
# it is still running. Only a process whose command line is one of this
# suite's servers is stopped; anything else on the port makes port_free fail.
stop_ours() {
  local file="$evals_dir/.servers/$1.pid" pid
  [ -f "$file" ] || return 0
  pid="$(cat "$file")"
  local command
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  if [ -n "$command" ] && { printf '%s' "$command" | grep -Fq "$lib_dir/serve-static.mjs" || printf '%s' "$command" | grep -Fq "$lib_dir/timed.mjs"; }; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
  fi
  rm -f "$file"
}

# Remember the server just started on <port>, so that the next run can stop it.
remember() {
  mkdir -p "$evals_dir/.servers"
  printf '%s\n' "$2" > "$evals_dir/.servers/$1.pid"
}

# Fails when something already listens on 127.0.0.1:<port> or localhost:<port>.
port_free() {
  node -e '
    const net = require("node:net");
    const port = Number(process.argv[1]);
    const probe = (host) => new Promise((resolve) => {
      const socket = net.connect(port, host, () => { socket.destroy(); resolve(true); });
      socket.on("error", () => resolve(false));
    });
    Promise.all([probe("127.0.0.1"), probe("::1")]).then((open) => process.exit(open.some(Boolean) ? 1 : 0));
  ' "$1" || fail "port $1 is in use; stop what listens there and run the case again"
}

# The plain HTML fixture of the repository with a dev script whose pre and post
# scripts the skill has to name. It has no dependencies, so node_modules is
# empty, as after an install.
html_dev_project() {
  cp -R "$repo_dir/fixtures/html-site/." .
  cp "$evals_dir/fixtures/html-dev/package.json" "$evals_dir/fixtures/html-dev/dev-server.mjs" .
  mkdir -p node_modules
}

# Serve this folder on a free port outside the sandbox; the port goes to .dev-port.
serve_workspace() {
  rm -f .dev-port
  nohup node "$lib_dir/serve-static.mjs" "$PWD" 0 "$PWD/.dev-port" "$SERVER_SECONDS" >/dev/null 2>&1 &
  wait_for_file .dev-port || fail "the static server did not start"
}

# A port where nothing listens, so that the crawl of the address the dev command prints fails.
dead_port() {
  node -e 'const s = require("node:net").createServer().listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });' > .dev-port
}

# Serve a folder of the evals on a fixed port, for a case whose prompt names the address.
serve_fixed() {
  local dir="$1" port="$2" file
  stop_ours "$port"
  port_free "$port"
  file="$(mktemp)"
  nohup node "$lib_dir/serve-static.mjs" "$dir" "$port" "$file" "$SERVER_SECONDS" >/dev/null 2>&1 &
  remember "$port" "$!"
  wait_for_file "$file" || fail "the static server did not start on port $port"
}

# The Next.js TypeScript fixture with the saved repo-mode run of it (made on
# 2026-11-12 with Next.js 16.4.6 at http://localhost:47320), in a git
# repository with one commit, so that a commit by Claude would be visible.
next_ts_project() {
  cp -R "$repo_dir/fixtures/next-ts/." .
  mkdir -p .seekwide
  cp -R "$evals_dir/fixtures/fix-base/seekwide/." .seekwide/
  printf '*\n' > .seekwide/.gitignore
  printf 'node_modules/\n.next/\nnext-env.d.ts\n' > .gitignore
  git init -q
  git add -A
  git commit -qm "Fixture"
}

# Start `next dev` for this folder on port 47320, the address of the saved run,
# with the dependencies evals/setup.sh installed. It listens on 127.0.0.1 only
# (its default is every interface), and localhost reaches it there. Whatever next dev writes into
# the project (Next.js 16.4 may write AGENTS.md) is committed, so the tree is
# clean when Claude starts.
start_next_dev() {
  local deps
  deps="$(cat "$evals_dir/.deps-dir" 2>/dev/null)" || fail "run evals/setup.sh first: it installs Next.js for the fix cases"
  [ -d "$deps/next-ts/node_modules" ] || fail "$deps/next-ts/node_modules is missing: run evals/setup.sh again"
  stop_ours 47320
  port_free 47320
  cp -cR "$deps/next-ts/node_modules" . 2>/dev/null || cp -R "$deps/next-ts/node_modules" .
  NEXT_TELEMETRY_DISABLED=1 nohup node "$lib_dir/timed.mjs" "$SERVER_SECONDS" "$TMPDIR/next-dev.log" \
    node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 47320 >/dev/null 2>&1 &
  remember 47320 "$!"
  for _ in $(seq 1 90); do
    curl -fs -o /dev/null http://localhost:47320/ && break
    sleep 1
  done
  curl -fs -o /dev/null http://localhost:47320/ || fail "next dev did not answer on port 47320; see $TMPDIR/next-dev.log"
  # Compile the pages once, so the crawl does not wait for it.
  for page in /about /products /products/alpha /products/beta /blog /blog/hello-widgets /robots.txt; do
    curl -s -o /dev/null "http://localhost:47320$page" || true
  done
  git add -A
  git commit -qm "Files next dev writes" || true
}

# Write this run's history.jsonl from the recorded first turn <name>
# (fixtures/recorded/<name>.jsonl, made by lib/record-history.mjs): the
# recording names the workspace of the run it was made in, and the paths have
# to be those of this run. A recording whose skill or reference text no longer
# matches the plugin is refused (lib/check-recording.mjs). Claude Code writes
# the resumed session next to the history file; an earlier run's is removed.
write_history() {
  local recorded="$evals_dir/fixtures/recorded/$1.jsonl"
  [ -f "$recorded" ] || fail "no recorded first turn $1: see 'Recording the first turns' in evals/README.md"
  node "$lib_dir/check-recording.mjs" "$1" >/dev/null || exit 1
  find "$case_dir" -maxdepth 1 -name '*.jsonl' -type f -delete
  node -e '
    const fs = require("node:fs");
    const [recorded, target, root, plugin] = process.argv.slice(1);
    const slug = (value) => value.replace(/[^A-Za-z0-9]/g, "-");
    const pairs = [["__EVAL_ROOT__", root], ["__EVAL_SLUG__", slug(root)], ["__PLUGIN_ROOT__", plugin], ["__PLUGIN_SLUG__", slug(plugin)]];
    let text = fs.readFileSync(recorded, "utf8");
    for (const [from, to] of pairs) text = text.split(from).join(to);
    fs.writeFileSync(target, text);
  ' "$recorded" "$case_dir/history.jsonl" "$(cd ../.. && pwd)" "$repo_dir"
}
