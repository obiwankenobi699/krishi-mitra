#!/usr/bin/env bash
# Native dev setup for Linux (no Docker required).
# Installs system deps, JS modules, ONE shared Python venv, and Ollama models.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# mise manages the toolchain (node, pnpm, python, uv — see mise.toml).
# Bootstrap it when missing so a fresh laptop needs nothing preinstalled.
if ! command -v mise >/dev/null 2>&1; then
  echo "==> Installing mise (toolchain manager)"
  curl -fsSL https://mise.run | sh
fi
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
if ! command -v mise >/dev/null 2>&1; then
  echo "❌ mise install failed — install manually (https://mise.run), restart your shell, re-run."
  exit 1
fi
# Persist shims on PATH for future shells (idempotent).
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  if [ -f "$rc" ] && ! grep -q "mise/shims" "$rc" 2>/dev/null; then
    echo 'export PATH="$HOME/.local/share/mise/shims:$PATH"' >> "$rc"
  fi
done

echo "==> Checking .env"
if [ ! -f .env ]; then
  echo "❌ Missing .env. Copy and fill it first:"
  echo "    cp .env.example .env"
  exit 1
fi
# shellcheck disable=SC1091
set -a; source .env; set +a

echo "==> Toolchain via mise (node, pnpm, python, uv)"
mise trust 2>/dev/null || true
mise install
command -v node >/dev/null 2>&1 || { echo "❌ mise shims not on PATH — restart your shell and re-run"; exit 1; }

echo "==> Checking system tools"
need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "❌ Missing: $1 ($2)"; MISSING=1; }; }
MISSING=0
need_cmd ollama "curl -fsSL https://ollama.com/install.sh | sh"
need_cmd tesseract "sudo apt install tesseract-ocr"
need_cmd pdftoppm "sudo apt install poppler-utils"
need_cmd ffmpeg "sudo apt install ffmpeg"
[ "$MISSING" = "1" ] && { echo "Install the missing tools above, then re-run."; exit 1; }

echo "==> JS modules (pnpm install)"
pnpm install

echo "==> Python deps — ONE shared venv (uv sync)"
uv sync

echo "==> Local state dirs"
mkdir -p .local/chroma_db .local/models .local/logs

# Service-local view of shared knowledge docs (lets groundtruth run from its dir)
ln -sfn ../../knowledge_documents services/groundtruth_ai/knowledge_documents

echo "==> Vosk offline STT model (~50MB, one-time)"
if [ ! -d .local/vosk-model ]; then
  curl -fsSL -o /tmp/vosk.zip "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
  unzip -q -o /tmp/vosk.zip -d /tmp && mv /tmp/vosk-model-small-en-us-0.15 .local/vosk-model && rm /tmp/vosk.zip
fi

echo "==> HF cache dir (local, writable)"
HF_DIR="${HF_HOME:-$HOME/.cache/huggingface}"
[ -w "$(dirname "$HF_DIR")" ] 2>/dev/null || HF_DIR="$ROOT/.local/hf_cache"
mkdir -p "$HF_DIR"
# Library path for venv CUDA/cuDNN wheels (TensorFlow GPU discovery)
LD_CANDIDATES=$(ls -d "$ROOT/.venv/lib/python"*/site-packages/nvidia/*/lib 2>/dev/null || true)
if [ -n "$LD_CANDIDATES" ]; then
  export LD_LIBRARY_PATH="$(echo "$LD_CANDIDATES" | tr '\n' ':')${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

echo "==> Ollama models (native, GPU; local: tags are never pulled)"
for model in "${LOCAL_LLM_MODEL:-local:disabled}" "${VISION_MODEL:-local:yolo11x-plant}"; do
  case "$model" in local:*|"") echo "==> $model is local — skipping Ollama pull"; continue;; esac
  ollama list 2>/dev/null | grep -q "$model" || { echo "==> ollama pull $model"; ollama pull "$model"; }
done

echo "==> Smoke test: boot fast services, prove health, shut down"
if ss -ltn 2>/dev/null | grep -qE ":(8000|8003) "; then
  echo "    (ports busy — stack already running, skipping smoke boot)"
else
  export PYTHONPATH="$ROOT/services"
  for spec in "platform_api:8000" "fieldscout_ai:8003"; do
    svc="${spec%%:*}"; port="${spec##*:}"
    (cd "services/$svc" && "$ROOT/.venv/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port "$port" > "$ROOT/.local/smoke-$svc.log" 2>&1 & echo $! > "$ROOT/.local/smoke-$svc.pid")
  done
  SMOKE_OK=1
  for spec in "8000:platform_api" "8003:fieldscout_ai"; do
    port="${spec%%:*}"; svc="${spec##*:}"
    ready=0
    for _ in $(seq 1 25); do
      if curl -sf --max-time 2 "http://localhost:$port/health" >/dev/null 2>&1; then ready=1; break; fi
      sleep 2
    done
    if [ "$ready" = "1" ]; then echo "    ✅ $svc :$port healthy"; else echo "    ❌ $svc :$port failed — see .local/smoke-$svc.log"; SMOKE_OK=0; fi
  done
  kill $(cat .local/smoke-*.pid 2>/dev/null) 2>/dev/null || true
  rm -f .local/smoke-*.pid .local/smoke-*.log
  [ "$SMOKE_OK" = "1" ] || { echo "❌ Smoke test failed — see logs above, then re-run setup."; exit 1; }
  echo "    (groundtruth/yieldwise warm their embedding models on first 'pnpm run dev')"
fi

echo ""
echo "✅ Setup complete. Start everything with:  pnpm run dev"
echo "   UI only:                                pnpm run web:dev"
