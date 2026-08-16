#!/usr/bin/env bash
# Smoke test: build + start + curl /, verify the page renders without RSC errors.
# Catches runtime errors that `next build` passes through (e.g. cookie writes
# during RSC rendering). See shared-plan/12-rsc-cookie-fix.md.
set -euo pipefail

PORT="${SMOKE_PORT:-3100}"
LOG_FILE="$(mktemp)"

# 1. Port occupancy pre-check before building
if ss -tlnp 2>/dev/null | grep -q ":${PORT} "; then
  echo "❌ [smoke] port ${PORT} is already in use (leftover server from a previous run?)"
  echo "   Tip: try running 'lsof -i :${PORT}' or 'pkill -f next-server' to clean up."
  exit 1
fi

echo "[smoke] Building..."
pnpm build > /dev/null 2>&1 || { echo "❌ [smoke] build failed"; exit 1; }

echo "[smoke] Starting server on :${PORT} (in-memory DB)..."
TURSO_DATABASE_URL=":memory:" TURSO_AUTH_TOKEN="" PORT="$PORT" setsid pnpm start > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
trap 'kill -- "-$SERVER_PID" 2>/dev/null || true' EXIT

# Wait for the server to accept connections (max 30s)
READY=0
for _ in $(seq 1 30); do
  if curl -sf "http://localhost:${PORT}/" > /dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "❌ [smoke] server did not become ready"
  tail -20 "$LOG_FILE"
  exit 1
fi

BODY="$(curl -s "http://localhost:${PORT}/")"

# Assertions (HTTP 200 is NOT a valid success signal — the broken state also
# returns 200 with an RSC error digest in the body).
if echo "$BODY" | grep -q 'E{"digest"'; then
  echo "❌ [smoke] RSC error digest found in response body"
  exit 1
fi
if grep -q "Cookies can only be modified" "$LOG_FILE"; then
  echo "❌ [smoke] cookie write error in server log"
  exit 1
fi
if ! echo "$BODY" | grep -q "News Watch"; then
  echo "❌ [smoke] page did not render (missing 'News Watch' heading)"
  exit 1
fi

echo "✅ [smoke] passed"
