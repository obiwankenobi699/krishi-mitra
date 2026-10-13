#!/usr/bin/env bash
# Full project restart: free ports, relaunch dev stack, verify health.
# Usage: bash scripts/restart.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/share/mise/shims:$PATH"

echo "==> Stopping project processes (ports 3000, 8000-8003)"
for p in 3000 8000 8001 8002 8003; do
  PID=$(ss -ltnp 2>/dev/null | grep ":$p " | grep -oP 'pid=\K[0-9]+' | head -1 || true)
  if [ -n "${PID:-}" ]; then echo "    killing :$p pid $PID"; kill "$PID" || true; fi
done
# Stray supervisors from older runs (bracket pattern never matches this shell)
pkill -f "[s]cripts/dev.sh" 2>/dev/null || true
sleep 3
STUCK=$(ss -ltn 2>/dev/null | grep -E ":(3000|8000|8001|8002|8003) " || true)
if [ -n "$STUCK" ]; then
  echo "❌ Ports still held after kill:"; echo "$STUCK"
  echo "   Find owners: ss -ltnp | grep :<port> — then kill PID and re-run."
  exit 1
fi
echo "    ports free"

echo "==> Starting stack (bash scripts/dev.sh)"
bash scripts/dev.sh
