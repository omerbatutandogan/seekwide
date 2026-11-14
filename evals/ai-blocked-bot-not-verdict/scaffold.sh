#!/usr/bin/env bash
# The same made-up bakery as ai-readiness-wording, on its own port: robots.txt
# keeps PerplexityBot, GPTBot and Applebot out. The workspace stays empty.
source "$(dirname "$0")/../lib/scaffold.sh"
serve_fixed "$evals_dir/fixtures/ai-site" 47335
