#!/usr/bin/env bash
# A made-up bakery whose robots.txt blocks some AI crawlers and whose press page
# says nosnippet, with an llms.txt, served at the address the prompt names. The
# workspace stays empty.
source "$(dirname "$0")/../lib/scaffold.sh"
serve_fixed "$evals_dir/fixtures/ai-site" 47334
