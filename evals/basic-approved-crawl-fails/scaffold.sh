#!/usr/bin/env bash
# The same project as basic-asks-first, but nothing answers at the address the
# dev command prints, so every crawl fails. Then the recorded first turn.
source "$(dirname "$0")/../lib/scaffold.sh"
html_dev_project
dead_port
write_history basic-asks-first
