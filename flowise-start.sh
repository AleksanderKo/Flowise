#!/usr/bin/env bash
# Start the local Flowise dev server (built from this repo's source).
# Usage: ./flowise-start.sh
set -uo pipefail

REPO="/home/erp/flowise_build"
LOG="$REPO/.flowise.local.log"
PIDFILE="$REPO/.flowise.local.pid"
PORT="${FLOWISE_PORT:-3000}"

# Load Node 24 via nvm (Flowise requires node ^24 / pnpm ^10)
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 24 >/dev/null 2>&1 || { echo "Node 24 not available via nvm. Run: nvm install 24"; exit 1; }

# Already running?
if curl -s -o /dev/null -m 2 "http://localhost:$PORT/" 2>/dev/null; then
    echo "Flowise is already running on http://localhost:$PORT"
    exit 0
fi

cd "$REPO" || exit 1

# setsid -> own process group so flowise-stop.sh can kill the whole tree
setsid pnpm start > "$LOG" 2>&1 < /dev/null &
PID=$!
echo "$PID" > "$PIDFILE"
echo "Starting Flowise (pgid $PID)  |  log: $LOG"

# Wait for readiness
for i in $(seq 1 120); do
    if grep -q "listening at :$PORT" "$LOG" 2>/dev/null; then
        echo "✅ Flowise is up: http://localhost:$PORT  (~${i}s)"
        exit 0
    fi
    if ! kill -0 "$PID" 2>/dev/null; then
        echo "❌ Process exited during startup. Last log lines:"
        tail -n 15 "$LOG"
        rm -f "$PIDFILE"
        exit 1
    fi
    sleep 1
done

echo "⚠️  Timed out waiting for startup. Check the log: $LOG"
exit 1
