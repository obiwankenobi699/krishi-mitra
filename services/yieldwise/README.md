# YieldWise

Financial planning + crop price estimation microservice (Prototype 2).

## Purpose

- **Financial plans**: RAG-backed advisor (`app/agents/financial_agents.py`).
  Retrieves scheme/loan context from the shared ChromaDB knowledge base
  (falls back to DuckDuckGo web search), estimates the current crop price,
  then asks the local LLM (via Ollama/litellm) to synthesize a plan.
- **Price estimator**: scikit-learn `GradientBoostingRegressor` pipeline
  (`price_estimator.pkl`) trained on `commodity_prices` in PostgreSQL.
  If the model or DB is absent, the service degrades gracefully
  (price section reports "not available", HTTP 503 only when the
  planning LLM/retrieval itself fails).

## Structure

```text
services/yieldwise/
  app/
    main.py              # FastAPI app, health routes, mounts api router
    api.py               # POST /generate-plan (+ validation schemas)
    agents/
      financial_agents.py  # FinancialAgent singleton, RAG + price logic
  train_price_estimator.py # Syncs data.gov.in daily prices into PostgreSQL,
                           # retrains + saves the estimator (standalone script)
  requirements.txt / requirements.lock  # legacy per-service pins (see root pyproject)
```

## Endpoints

All paths below are served natively on **port 8002**.
`POST /generate-plan` requires header `x-internal-api-key: <INTERNAL_API_KEY>`
(server-to-server auth via `shared.core.security`). Health routes are public.

| Method | Path             | Body / Response |
|--------|------------------|-----------------|
| GET    | `/`, `/health`   | `{"status": "ok", "service": "YieldWise"}` |
| POST   | `/generate-plan` | `{land_size, crop, state, district}` → `{plan: str}`; 503 if the planning backend is unavailable |

Example:

```bash
curl -X POST localhost:8002/generate-plan \
  -H "Content-Type: application/json" \
  -H "x-internal-api-key: $INTERNAL_API_KEY" \
  -d '{"land_size": 2.5, "crop": "Onion", "state": "Karnataka", "district": "Bangalore"}'
```

## Environment

| Variable | Used for | Default |
|----------|----------|---------|
| `MODEL_DIR` | `price_estimator.pkl`, `model_features.json` | `/models` (Docker); override to `.local/models` natively |
| `CHROMA_DB_PATH` | Persistent ChromaDB (`agri_knowledge_base`) | `/chroma_db` |
| `HF_HOME` | HuggingFace/embedding-model cache | `/root/.cache/huggingface` |
| `DATABASE_URL` / `SUPABASE_DB_URL` / `POSTGRES_*` | Async DB URL; sync URL derived via `settings.SYNC_DATABASE_URL` | — (required) |
| `DATA_GOV_API_KEY` | data.gov.in daily price sync (train script) | `""` (sync skipped, existing DB data used) |
| `LOCAL_LLM_MODEL`, `OLLAMA_API_BASE_URL` | Plan generation LLM | — (required for plans) |
| `EMBEDDING_MODEL_NAME` | RAG query embeddings (CUDA; `REQUIRE_GPU=0` to allow CPU) | — |
| `INTERNAL_API_KEY` | `x-internal-api-key` auth | — (required) |

## Train script usage

`train_price_estimator.py` is standalone (run, not imported):

1. Downloads the daily commodity-price CSV from data.gov.in
   (skipped with a warning if the API/key is unreachable).
2. Appends only new records to the `commodity_prices` table.
3. Retrains the GradientBoosting pipeline on the full table (skipped
   when no new data arrived and a model file already exists) and writes
   `price_estimator.pkl` + `model_features.json` to `MODEL_DIR`.
4. Never crashes the service path: with no data and no saved model it
   logs and exits; the API then reports price estimation unavailable.

```bash
cd services/yieldwise
PYTHONPATH=/home/mukul/Main/Projects/Agri-Agentic-Suite/services \
MODEL_DIR=/home/mukul/Main/Projects/Agri-Agentic-Suite/.local/models \
/home/mukul/Main/Projects/Agri-Agentic-Suite/.venv/bin/python train_price_estimator.py
```

## Native run (port 8002)

```bash
cd services/yieldwise
PYTHONPATH=/home/mukul/Main/Projects/Agri-Agentic-Suite/services \
CHROMA_DB_PATH=/home/mukul/Main/Projects/Agri-Agentic-Suite/.local/chroma_db \
MODEL_DIR=/home/mukul/Main/Projects/Agri-Agentic-Suite/.local/models \
HF_HOME=/home/mukul/Main/Projects/Agri-Agentic-Suite/.local/hf_cache \
/home/mukul/Main/Projects/Agri-Agentic-Suite/.venv/bin/python -m uvicorn app.main:app --port 8002
```

Smoke test (import only):

```bash
cd services/yieldwise && PYTHONPATH=/home/mukul/Main/Projects/Agri-Agentic-Suite/services \
CHROMA_DB_PATH=/home/mukul/Main/Projects/Agri-Agentic-Suite/.local/chroma_db \
MODEL_DIR=/home/mukul/Main/Projects/Agri-Agentic-Suite/.local/models \
HF_HOME=/home/mukul/Main/Projects/Agri-Agentic-Suite/.local/hf_cache \
/home/mukul/Main/Projects/Agri-Agentic-Suite/.venv/bin/python -c "import app.main; print('IMPORT_OK')"
```

Note: importing `app.main` instantiates `FinancialAgent`, which loads the
embedding model (needs CUDA unless `REQUIRE_GPU=0`) and reads `.env` for
required settings (`SECRET_KEY`, `INTERNAL_API_KEY`, DB URL, LLM config).
