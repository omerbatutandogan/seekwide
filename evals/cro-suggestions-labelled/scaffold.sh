#!/usr/bin/env bash
# A made-up plumbing firm whose contact form has ordinary mistakes (an unnamed
# field, an autocomplete value the standard does not define, email and phone
# typed as text, blocked pasting) and a tel: link with letters, with an IAB TCF
# stub on every page, served at the address the prompt names. The workspace
# stays empty.
source "$(dirname "$0")/../lib/scaffold.sh"
serve_fixed "$evals_dir/fixtures/cro-site" 47336
