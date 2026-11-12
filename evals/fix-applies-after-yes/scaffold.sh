#!/usr/bin/env bash
# The project of fix-shows-diffs, with next dev running outside the sandbox at
# the address of the saved run, and that case's recorded first turn.
source "$(dirname "$0")/../lib/scaffold.sh"
next_ts_project
start_next_dev
write_history fix-shows-diffs
