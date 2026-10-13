#!/usr/bin/env bash
# Native dev runner for Linux (no Docker). Ollama runs natively, DB is Supabase cloud.
# Ports: web 3000, platform_api 8000, groundtruth 8001, yieldwise 8002, fieldscout 8003.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# mise shims first so node/pnpm/python/uv resolve to pinned versions
export PATH="$HOME/.local/share/mise/shims:$PATH"

[ -f .env ] || { echo "❌ Missing .env — run: pnpm run setup"; exit 1; }
# shellcheck disable=SC1091
set -a; source .env; set +a

command -v ollama >/dev/null || { echo "❌ ollama not installed — run: pnpm run setup"; exit 1; }
command -v uv >/dev/null || { echo "❌ uv not installed — run: pnpm run setup"; exit 1; }
[ -x ".venv/bin/python" ] || { echo "❌ .venv missing — run: pnpm run setup"; exit 1; }

mkdir -p .local/chroma_db .local/models .local/logs .local/uploads

# --- Native overrides (Docker hostnames -> localhost) ---
# NOTE: forced localhost — .env carries Docker's service hostnames for compose.
export OLLAMA_API_BASE_URL="http://localhost:11434"
export GROUNDTRUTH_URL="http://localhost:8001"
export YIELDWISE_URL="http://localhost:8002"
export FIELDSCOUT_URL="http://localhost:8003"
export PYTHONPATH="$ROOT/services"
export CHROMA_DB_PATH="$ROOT/.local/chroma_db"
export MODEL_DIR="$ROOT/.local/models"
export KNOWLEDGE_DOCS_DIR="$ROOT/knowledge_documents"
export VOSK_MODEL_PATH="$ROOT/.local/vosk-model"
export UPLOAD_STAGING_DIR="$ROOT/.local/uploads"
export REQUIRE_GPU="${REQUIRE_GPU:-1}"
# Native HF cache: .env points at Docker's /shared/hf_cache (not writable natively)
HF_DIR="${HF_HOME:-$HOME/.cache/huggingface}"
[ -w "$(dirname "$HF_DIR")" ] 2>/dev/null || HF_DIR="$ROOT/.local/hf_cache"
mkdir -p "$HF_DIR"
export HF_HOME="$HF_DIR"
# CUDA/cuDNN wheels live inside the venv (torch cu13 + TF cu12 layouts);
# TensorFlow only finds them via an explicit library path (else: no GPU).
LD_CANDIDATES=$(ls -d "$ROOT/.venv/lib/python"*/site-packages/nvidia/*/lib 2>/dev/null || true)
if [ -n "$LD_CANDIDATES" ]; then
  export LD_LIBRARY_PATH="$(echo "$LD_CANDIDATES" | tr '\n' ':')${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:8000}"

# --- Single-instance guard: refuse to start if another stack holds these ports ---
port_in_use() { # port -> 0 if something is listening
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -Eq "[:.]$1([^0-9]|$)"
  else
    (echo > "/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
  fi
}
TAKEN=""
for p in 3000 8000 8001 8002 8003; do
  if port_in_use "$p"; then TAKEN="$TAKEN $p"; fi
done
# :11434 is shared with a natively-running ollama — only a conflict if it isn't ollama
if port_in_use 11434; then
  if ! curl -sf --max-time 2 "$OLLAMA_API_BASE_URL/api/tags" >/dev/null 2>&1; then
    TAKEN="$TAKEN 11434"
  fi
fi
if [ -n "$TAKEN" ]; then
  echo "❌ Port(s)$TAKEN already in use — stop the other stack first, then re-run."
  exit 1
fi

# --- Ollama native (VRAM guard: sequential by default, wider on big GPUs) ---
export OLLAMA_MAX_LOADED_MODELS="${OLLAMA_MAX_LOADED_MODELS:-1}"
# --- VRAM-adaptive tier: bigger GPUs run more on GPU (lower latency) ---
# efficient (<=4GB): YOLO on CPU (~0.3s, still fast), 1 request at a time.
# performance (6GB+): YOLO on CUDA (~0.1s) alongside the LLM + parallel requests.
VRAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
VRAM_MB=${VRAM_MB:-0}
if [ "${VRAM_MB:-0}" -ge 6000 ]; then
  export YOLO_PROVIDERS="${YOLO_PROVIDERS:-cuda,cpu}"
  export OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-2}"
  export OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-10m}"
  echo "==> GPU tier: performance (${VRAM_MB}MB VRAM — YOLO on CUDA, parallel LLM)"
else
  export YOLO_PROVIDERS="${YOLO_PROVIDERS:-cpu}"
  export OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-1}"
  export OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-5m}"
  echo "==> GPU tier: efficient (${VRAM_MB}MB VRAM — YOLO on CPU, sequential LLM)"
fi
if ! curl -sf --max-time 3 "$OLLAMA_API_BASE_URL/api/tags" >/dev/null 2>&1; then
  echo "==> Starting ollama serve (native)"
  nohup ollama serve > .local/logs/ollama.log 2>&1 &
  for _ in $(seq 1 20); do
    curl -sf --max-time 2 "$OLLAMA_API_BASE_URL/api/tags" >/dev/null 2>&1 && break
    sleep 2
  done
  if ! curl -sf --max-time 2 "$OLLAMA_API_BASE_URL/api/tags" >/dev/null 2>&1; then
    echo "❌ ollama failed to start — see .local/logs/ollama.log"
    exit 1
  fi
else
  echo "==> Ollama already running — restart 'ollama serve' if you changed OLLAMA_MAX_LOADED_MODELS/NUM_PARALLEL/KEEP_ALIVE"
fi
for model in "${LOCAL_LLM_MODEL:-local:disabled}" "${VISION_MODEL:-local:yolo11x-plant}"; do
  case "$model" in local:*|"") echo "==> $model is local — skipping Ollama pull"; continue;; esac
  ollama list 2>/dev/null | grep -q "$model" || { echo "==> ollama pull $model"; ollama pull "$model"; }
done
echo "==> Ollama OK ($OLLAMA_API_BASE_URL)"

# --- Optional: knowledge-base doc sync (needs metadata.json + network) ---
# Runs from the service dir (govt.pem lives there); knowledge_documents is symlinked by setup.
if [ -f knowledge_documents/metadata.json ]; then
  echo "==> Syncing knowledge documents"
  (cd "$ROOT/services/groundtruth_ai" && "$ROOT/.venv/bin/python" download_docs.py) 2>&1 | tail -3 || true
fi

PIDS=""

start_svc() { # name dir port
  echo "==> $1 on :$3"
  (cd "services/$2" && PYTHONPATH="$PYTHONPATH" \
    "$ROOT/.venv/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port "$3" \
    > "$ROOT/.local/logs/$1.log" 2>&1 & echo $! >> "$ROOT/.local/pids")
}

rm -f .local/pids
start_svc groundtruth groundtruth_ai 8001
start_svc yieldwise yieldwise 8002
start_svc fieldscout fieldscout_ai 8003

echo "==> Waiting for AI services"
for port in 8001 8002 8003; do
  for _ in $(seq 1 30); do
    curl -sf --max-time 2 "http://localhost:$port/" >/dev/null 2>&1 && break
    sleep 2
  done
done
for svc in "groundtruth:8001" "yieldwise:8002" "fieldscout:8003"; do
  name="${svc%%:*}"; port="${svc##*:}"
  if ! curl -sf --max-time 2 "http://localhost:$port/" >/dev/null 2>&1; then
    echo "❌ $name failed to start — see .local/logs/$name.log"
    exit 1
  fi
done

start_svc platform platform_api 8000
echo "==> Waiting for gateway :8000"
for _ in $(seq 1 30); do
  curl -sf --max-time 2 "http://localhost:8000/health" >/dev/null 2>&1 && break
  sleep 2
done
if ! curl -sf --max-time 2 "http://localhost:8000/health" >/dev/null 2>&1; then
  echo "❌ platform failed to start — see .local/logs/platform.log"
  exit 1
fi

echo "==> Web on :3000"
pnpm run web:dev > .local/logs/web.log 2>&1 &
echo $! >> .local/pids

cleanup() {
  echo ""; echo "==> Stopping all services"
  [ -f .local/pids ] && xargs -r kill < .local/pids 2>/dev/null || true
  rm -f .local/pids
}
trap cleanup INT TERM EXIT

echo ""
echo "✅ All up:  web http://localhost:3000  api http://localhost:8000  (logs in .local/logs/)"
echo "   Press Ctrl+C to stop everything."
wait
