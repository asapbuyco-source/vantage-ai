#!/usr/bin/env bash
# Railway start wrapper — prints diagnostics so deploy logs show the real error
set -x
echo "=== [start] node version: $(node --version)"
echo "=== [start] cwd: $(pwd)"
echo "=== [start] files in /app:"
ls -la
echo "=== [start] playwright present? $(node -e "require.resolve('playwright')" 2>&1 || echo MISSING)"
echo "=== [start] xvfb-run present? $(which xvfb-run || echo MISSING)"
echo "=== [start] launching scanner (loop 2 min)..."
exec xvfb-run -a node arb_scanner_live.js --loop=2