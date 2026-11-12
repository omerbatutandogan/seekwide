#!/usr/bin/env bash
# The same project as basic-asks-first, and that case's recorded first turn
# with the paths of this run.
source "$(dirname "$0")/../lib/scaffold.sh"
html_dev_project
# Served, so that a Claude that starts the dev command without asking could also crawl it.
serve_workspace
write_history basic-asks-first
