#!/bin/sh
# Host-side golden + mapping tests for the 0.42 input mapping. Usage: tests/host_map/build.sh [run]
# REFRESH=1 [OLD_REPO=/path/to/repo] [OLD_REV=31d19b1] re-extracts the 0.41 builders into old_reports.inc first.
set -e
cd "$(dirname "$0")"
BIN="${TMPDIR:-/tmp}/yagcc_host_map_golden"
if [ -n "$REFRESH" ]; then
  git -C "${OLD_REPO:-../../..}" show "${OLD_REV:-31d19b1}:firmware/src/main.c" > /tmp/yagcc_old_main.c
  python3 - <<'PY'
src=open('/tmp/yagcc_old_main.c').read()
a=src.index('typedef struct {\n    bool green'); b=src.index('// ---------------------------------------------------------------- USB suspend')
c=src.index('// whammy 0..32767 -> full signed range'); d=src.index('static bool needs_host')
open('old_reports.inc','w').write("// Frozen copy of the 0.41 report builders, the golden reference for golden.c.\n// build.sh REFRESH=1 re-extracts it from a git revision of the repo.\n"+src[a:b]+src[c:d])
PY
fi
${CC:-cc} -std=gnu11 -O1 -Wall -Wextra -Wno-unused-function -Wno-unused-variable -I../../src -o "$BIN" golden.c
"$BIN"
