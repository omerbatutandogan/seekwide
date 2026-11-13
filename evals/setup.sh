#!/usr/bin/env bash
# Install what the /seekwide:fix cases need: Next.js and its dependencies for
# fixtures/next-ts, in a cache folder outside the repository, so that no
# node_modules folder lands in it. The scaffolds copy that folder into each
# workspace. Run it once before `claude plugin eval plugin --scaffold`, with
# evals/ linked into plugin/ (evals/README.md). The dependency tree is the one
# fixtures/next-ts/package-lock.json pins, installed with `npm ci` and no
# install scripts.
#
# Usage: evals/setup.sh            (cache in ${XDG_CACHE_HOME:-~/.cache}/seekwide-evals)
#        SEEKWIDE_EVAL_CACHE=/path evals/setup.sh

set -euo pipefail

evals_dir="$(cd "$(dirname "$0")" && pwd)"
cache="${SEEKWIDE_EVAL_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/seekwide-evals}"

mkdir -p "$cache/next-ts"
cp "$evals_dir/../fixtures/next-ts/package.json" "$evals_dir/../fixtures/next-ts/package-lock.json" "$cache/next-ts/"
(cd "$cache/next-ts" && npm ci --no-audit --no-fund --ignore-scripts)
printf '%s\n' "$cache" > "$evals_dir/.deps-dir"
echo "Installed Next.js for the eval fixtures in $cache/next-ts."
