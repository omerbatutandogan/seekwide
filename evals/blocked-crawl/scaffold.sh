#!/usr/bin/env bash
# A site whose robots.txt disallows everything, served at the address the
# prompt names. The workspace stays empty: this is an audit by URL.
source "$(dirname "$0")/../lib/scaffold.sh"
serve_fixed "$evals_dir/fixtures/blocked-site" 47331
