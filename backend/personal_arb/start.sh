#!/usr/bin/env bash
# Railway start wrapper — explicit Xvfb (xvfb-run can hang in containers) + diagnostics
set -x
echo "=== [start] node version: $(node --version)"
echo "=== [start] cwd: $(pwd)"
echo "=== [start] playwright: $(node -e "console.log(require.resolve('playwright'))" 2>&1 || echo MISSING)"
echo "=== [start] starting Xvfb on :99..."
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
XVFB_PID=$!
sleep 3
if kill -0 $XVFB_PID 2>/dev/null; then
  echo "=== [start] Xvfb running (pid $XVFB_PID)"
else
  echo "=== [start] Xvfb FAILED to start — 1xbet headed won't work, others still will"
fi
export DISPLAY=:99
echo "=== [start] DISPLAY=$DISPLAY — launching scanner (loop 2 min)..."
exec node arb_scanner_live.js --loop=2