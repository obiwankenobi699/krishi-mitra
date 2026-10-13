#!/usr/bin/env bash
# Health check for a running `pnpm run dev` stack.
# Exit 0 when everything answers, 1 otherwise. Read-only: starts nothing.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS + 1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
section() { echo "==> $1"; }

section "prerequisites"
[ -f .env ] && ok ".env present" || bad ".env missing — copy .env.example"
[ -x ".venv/bin/python" ] && ok "root .venv present" || bad "root .venv missing — run pnpm run setup"
command -v ollama >/dev/null && ok "ollama installed" || bad "ollama not installed"
[ -f ".local/models/yolo11-plant/plantvillage_yolo11x.onnx" ] && ok "YOLO weights staged" || bad "YOLO weights missing in .local/models/yolo11-plant/"
nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits >/dev/null 2>&1 \
  && ok "NVIDIA GPU: $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1)" \
  || bad "no NVIDIA GPU visible"

section "processes"
for spec in "3000:web" "8000:gateway" "8001:groundtruth" "8002:yieldwise" "8003:fieldscout" "11434:ollama"; do
  port="${spec%%:*}"; name="${spec##*:}"
  if curl -sf --max-time 3 "http://localhost:$port/" >/dev/null 2>&1 \
     || curl -sf --max-time 3 "http://localhost:$port/health" >/dev/null 2>&1 \
     || curl -sf --max-time 3 "http://localhost:$port/api/tags" >/dev/null 2>&1; then
    ok "$name :$port answering"
  else
    bad "$name :$port silent"
  fi
done

section "api contracts"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:8000/marketplace )
[ "$code" = "200" ] && ok "GET /marketplace -> 200" || bad "GET /marketplace -> $code"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:8000/news )
[ "$code" = "200" ] && ok "GET /news -> 200" || bad "GET /news -> $code"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST http://localhost:8000/ai/diagnose )
[ "$code" = "401" ] && ok "POST /ai/diagnose unauth -> 401 (auth gate holds)" || bad "POST /ai/diagnose unauth -> $code (want 401)"
if ollama list 2>/dev/null | grep -q "qwen25-3b-farm"; then
  ok "LLM qwen25-3b-farm pulled"
else
  bad "LLM qwen25-3b-farm missing — RAG/plans will 503"
fi
curl -s --max-time 5 http://localhost:11434/api/ps 2>/dev/null | grep -q "qwen25-3b-farm" \
  && ok "LLM resident on GPU" || echo "  ⚠️  LLM not currently loaded (loads on first request)"

section "supabase"
set -a; source .env 2>/dev/null; set +a
if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_PUBLISHABLE_KEY:-}" ]; then
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 \
    "$SUPABASE_URL/rest/v1/listings?select=id&limit=1" \
    -H "apikey: $SUPABASE_PUBLISHABLE_KEY" )
  [ "$code" = "200" ] && ok "Supabase REST reachable (listings -> $code)" || bad "Supabase REST -> $code"
else
  bad "SUPABASE_URL / publishable key unset in .env"
fi

echo ""
echo "RESULT: $PASS pass, $FAIL fail"
[ "$FAIL" = "0" ]
