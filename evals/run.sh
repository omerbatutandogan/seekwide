#!/usr/bin/env bash
# Run the skill-flow evals (evals/README.md, "Running it").
#
# `claude plugin eval` reads cases only from a folder inside the plugin and
# refuses a link that points outside it, so this script copies the cases, lib/
# and fixtures/ to plugin/evals (ignored by git), tells the scaffolds where the
# repository is (plugin/evals/.repo-dir), runs the suite once and removes the
# copy again, also when the run fails or is interrupted. Results go to
# evals/results/<UTC timestamp>/.
#
# Usage: evals/run.sh [--keep-temp] [case ...]   (no case: every case)

set -euo pipefail

evals_dir="$(cd -P "$(dirname "$0")" && pwd -P)"
repo_dir="$(cd -P "$evals_dir/.." && pwd -P)"
copy="$repo_dir/plugin/evals"

keep_temp=()
cases=()
for arg in "$@"; do
  case "$arg" in
    --keep-temp) keep_temp=(--keep-temp) ;;
    -*) echo "run.sh: unknown option $arg" >&2; exit 2 ;;
    *) cases+=("$arg") ;;
  esac
done
if [ "${#cases[@]}" -eq 0 ]; then
  for file in "$evals_dir"/*/case.yaml; do
    cases+=("$(basename "$(dirname "$file")")")
  done
fi
for name in "${cases[@]}"; do
  [ -f "$evals_dir/$name/case.yaml" ] || { echo "run.sh: no case $name in evals/" >&2; exit 2; }
done

# One run at a time: two runs share plugin/evals. The lock is a directory (mkdir is atomic) holding the
# runner's pid. A lock whose process is gone, or is no longer this script, was left by a run that was
# killed (SIGKILL skips the exit trap) and is taken over.
lock="$evals_dir/.run.lock"
lock_owner() {
  local pid
  pid="$(cat "$lock/pid" 2>/dev/null || true)"
  if [ -z "$pid" ]; then sleep 1; pid="$(cat "$lock/pid" 2>/dev/null || true)"; fi
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= 2>/dev/null | grep -q 'run\.sh' && echo "$pid"
  return 0
}
if ! mkdir "$lock" 2>/dev/null; then
  owner="$(lock_owner)"
  if [ -n "$owner" ]; then
    echo "run.sh: another run of the evals (pid $owner) is in progress; wait for it to end." >&2
    exit 1
  fi
  rm -rf "$lock"
  mkdir "$lock" 2>/dev/null || { echo "run.sh: another run of the evals is starting; try again." >&2; exit 1; }
fi
echo "$$" > "$lock/pid"
trap 'rm -rf "$copy" "$lock"' EXIT
# A copy left by a run that was killed, or the link of the earlier layout: plugin/evals is only ever ours.
rm -rf "$copy"
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$copy"
for name in "${cases[@]}"; do
  cp -R "$evals_dir/$name" "$copy/"
  # The history file and the resumed session an earlier run left in the case folder.
  find "$copy/$name" -maxdepth 1 -name '*.jsonl' -type f -delete
done
cp -R "$evals_dir/lib" "$evals_dir/fixtures" "$copy/"
printf '%s\n' "$repo_dir" > "$copy/.repo-dir"

results="$evals_dir/results/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$results"
echo "Cases: ${cases[*]}"
echo "Results: $results"

cd "$repo_dir"
claude plugin eval plugin --trust-plugin --scaffold --allow-real-servers \
  --allow-tools Bash Edit Write mcp__plugin_seekwide_seekwide "Read(/$repo_dir/plugin/references/**)" \
  --ablation none --no-publish --runs 1 --judge-model haiku \
  "${keep_temp[@]+"${keep_temp[@]}"}" --output-dir "$results" 2>&1 | tee "$results/run.log"
