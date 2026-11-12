#!/usr/bin/env bash
# The same project as basic-asks-first, served outside the sandbox; the dev
# command prints that address. Then the recorded first turn.
source "$(dirname "$0")/../lib/scaffold.sh"
html_dev_project
serve_workspace
write_history basic-asks-first
