#!/usr/bin/env bash
# LLM shootout for the farm stack: RAG fidelity + strict-JSON adherence + speed.
# Usage: bash scripts/bench-llm.sh <model-tag> [model-tag...]
# Requires ollama serve running. Prints tok/s, load, JSON validity, and answers
# for human grading. Small models, short prompts — keep num_ctx tight.
set -euo pipefail

API="${OLLAMA_API_BASE_URL:-http://localhost:11434}"

rag_prompt() {
  cat <<'EOF'
Context: "Tomato Early Blight appears as dark concentric spots on older leaves. Remove affected leaves and apply copper-based fungicide. Source: https://example.gov/tomato-guide"

Question: "My tomato has dark spots on older leaves. What is it and what do I do?"

Answer strictly using the context:
EOF
}

json_prompt() {
  cat <<'EOF'
Return only one JSON object with exactly these fields: condition (string), confidence (number 0-1), severity (one of none, low, medium, high, unknown), observations (string array, max 3), summary (string, max 2 sentences). No Markdown fences.
Image shows: tomato leaf with dark concentric rings on lower leaves.
EOF
}

run_case() { # model, name, prompt, max_tokens
  local model="$1" name="$2" prompt="$3" max_tokens="$4"
  local t0 t1 ms resp text evals_per_sec done_reason
  t0=$(date +%s%N)
  resp=$(curl -s --max-time 300 "$API/api/generate" \
    -H 'Content-Type: application/json' \
    -d "$(/usr/bin/python3 -c "import json,sys; print(json.dumps({'model': sys.argv[1], 'prompt': sys.argv[2], 'stream': False, 'options': {'num_ctx': 4096, 'temperature': 0.2, 'num_predict': int(sys.argv[3])}}))" "$model" "$prompt" "$max_tokens")")
  t1=$(date +%s%N)
  ms=$(( (t1 - t0) / 1000000 ))
  text=$(echo "$resp" | /usr/bin/python3 -c "import json,sys; print(json.load(sys.stdin).get('response',''))")
  evals_per_sec=$(echo "$resp" | /usr/bin/python3 -c "import json,sys; print(json.load(sys.stdin).get('eval_rate','n/a'))")
  done_reason=$(echo "$resp" | /usr/bin/python3 -c "import json,sys; print(json.load(sys.stdin).get('done_reason','?'))")
  echo "### [$model] $name — ${ms}ms wall, ${evals_per_sec} tok/s, stop=$done_reason"
  echo "$text"
  echo "---JSON-CHECK---"
  echo "$text" | /usr/bin/python3 -c "
import json,sys
raw = sys.stdin.read().strip()
if raw.startswith('\`\`\`'):
    raw = raw.removeprefix('\`\`\`json').removeprefix('\`\`\`').removesuffix('\`\`\`').strip()
try:
    o = json.loads(raw)
    need = {'condition','confidence','severity','observations','summary'}
    print('VALID_JSON keys_ok=', need <= set(o.keys()), 'keys=', sorted(o.keys()))
except Exception as e:
    print('INVALID_JSON:', str(e)[:120])
"
  echo ""
}

[ "$#" -ge 1 ] || { echo "usage: bash scripts/bench-llm.sh <model> [model...]"; exit 1; }
for model in "$@"; do
  echo "==================================== MODEL: $model"
  run_case "$model" "rag-answer" "$(rag_prompt)" 300
  run_case "$model" "strict-json" "$(json_prompt)" 512
done
