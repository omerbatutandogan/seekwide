#!/usr/bin/env bash
# The hacked copy of the café site of the repository's security fixtures,
# served at the address the prompt names. The workspace stays empty.
source "$(dirname "$0")/../lib/scaffold.sh"
serve_fixed "$repo_dir/fixtures/security/injected" 47332
