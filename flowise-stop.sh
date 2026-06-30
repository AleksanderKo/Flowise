#!/usr/bin/env bash
# Stop the local Flowise dev server started by flowise-start.sh.
# Usage: ./flowise-stop.sh
set -uo pipefail

REPO="/home/erp/flowise_build"
PIDFILE="$REPO/.flowise.local.pid"
PORT="${FLOWISE_PORT:-3000}"

stopped=0

# 1) Kill the whole process group recorded by the start script
if [ -f "$PIDFILE" ]; then
    PGID="$(cat "$PIDFILE" 2>/dev/null)"
    if [ -n "${PGID:-}" ] && kill -0 "$PGID" 2>/dev/null; then
        kill -TERM -- "-$PGID" 2>/dev/null
        sleep 2
        kill -KILL -- "-$PGID" 2>/dev/null
        stopped=1
    fi
    rm -f "$PIDFILE"
fi

# 2) Fallback: kill whatever is holding the port
for p in $(ss -ltnp 2>/dev/null | grep ":$PORT" | grep -oP 'pid=\K[0-9]+' | sort -u); do
    kill -KILL "$p" 2>/dev/null && stopped=1
done

# 3) Fallback: leftover pnpm/run wrappers
pkill -9 -f "run-script-os" 2>/dev/null && stopped=1
pkill -9 -f "packages/server/bin" 2>/dev/null || true

sleep 1
if curl -s -o /dev/null -m 2 "http://localhost:$PORT/" 2>/dev/null; then
    echo "⚠️  Port $PORT is still responding — another process may be holding it."
    exit 1
fi

if [ "$stopped" -eq 1 ]; then
    echo "🛑 Flowise stopped (port $PORT free)."
else
    echo "Flowise was not running (port $PORT already free)."
fi
