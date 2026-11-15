#!/usr/bin/env bash
# A made-up walking tour company with a half-empty title, a title with last
# year's year, a duplicate title and a viewport that stops zooming, served at
# the address the prompt names. The workspace stays empty.
source "$(dirname "$0")/../lib/scaffold.sh"
serve_fixed "$evals_dir/fixtures/sxo-site" 47337
