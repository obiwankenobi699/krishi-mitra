#!/usr/bin/env bash
# Doctor: fresh-laptop audit for the Agraya stack. Read-only (installs nothing).
# Checks toolchain versions vs mise.toml, system deps, GPU, .env keys,
# ports, disk, and prints a fix hint per failure. Exit 0 when all green.
# Usage: bash scripts/doctor.sh  (or: pnpm run doctor)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/share/mise/shims:$PATH"

PASS=0
FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
bad() { echo "  ❌ $1"; echo "     fix: $2"; FAIL=$((FAIL + 1)); }
warn() { echo "  ⚠️  $1"; }

echo "==> toolchain (mise.toml pins)"
command -v mise >/dev/null 2>&1 && ok "mise present" || bad "mise missing" "curl https://mise.run | sh, restart shell"
for tool in node pnpm uv; do
  if command -v $tool >/dev/null 2>&1; then ok "$tool $($tool --version 2>/dev/null | head -1)"; else bad "$tool missing" "mise install (after mise present)"; fi
done
command -v python3 >/dev/null 2>&1 && ok "python3 present" || bad "python3 missing" "mise install"
[ -x .venv/bin/python ] && ok "root .venv ($(./.venv/bin/python --version 2>&1))" || bad "root .venv missing" "pnpm run setup"

echo "==> system binaries (doc OCR / audio / pdf)"
for tool in ollama tesseract pdftoppm ffmpeg; do
  command -v $tool >/dev/null 2>&1 && ok "$tool present" || bad "$tool missing" "Linux: sudo apt install ${tool}; Windows: winget (see setup.ps1)"
done

echo "==> gpu"
if command -v nvidia-smi >/dev/null 2>&1; then
  VRAM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
  ok "NVIDIA GPU ${VRAM}MiB total"
  [ "${VRAM:-0}" -ge 6000 ] 2>/dev/null && echo "     tier: performance (YOLO CUDA, parallel LLM)" || echo "     tier: efficient (YOLO CPU, sequential LLM)"
  [ -x .venv/bin/python ] && .venv/bin/python -c "import torch; assert torch.cuda.is_available()" 2>/dev/null \
    && ok "torch CUDA visible" || warn "torch CUDA not visible (embeddings need it; check LD_LIBRARY_PATH via dev.sh)"
else
  bad "no NVIDIA GPU" "CPU-only is unsupported by current policy (REQUIRE_GPU=1)"
fi
[ -f .local/models/yolo11-plant/plantvillage_yolo11x.onnx ] \
  && ok "YOLO weights staged" || bad "YOLO weights missing" "see services/fieldscout_ai/README.md"

echo "==> configuration (.env values never printed)"
[ -f .env ] || { bad ".env missing" "cp .env.example .env and fill Supabase values"; }
for key in SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY SECRET_KEY INTERNAL_API_KEY NEXT_PUBLIC_SUPABASE_URL; do
  val=$(grep "^$key=" .env 2>/dev/null | cut -d= -f2-)
  [ -n "$val" ] && ok "$key set" || bad "$key empty" "fill it in .env (Supabase dashboard / keys)"
done
grep -q "REPLACE_ME" .env 2>/dev/null && warn "SUPABASE_DB_URL still placeholder (price training degraded; app runs)"

echo "==> ports (expect FREE unless stack is running)"
for p in 3000 8000 8001 8002 8003 11434; do
  if ss -ltn 2>/dev/null | grep -q ":$p "; then
    echo "     :$p busy (fine if dev is running, else restart.sh frees it)"
  else
    echo "     :$p free"
  fi
done

echo "==> disk"
df -h "$ROOT" | tail -1 | awk '{print "     " $4 " free on " $6}'
[ -d node_modules ] && ok "node_modules present" || warn "node_modules missing — pnpm install"

echo ""
echo "RESULT: $PASS pass, $FAIL fail"
[ "$FAIL" = "0" ]
