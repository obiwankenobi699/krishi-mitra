# GroundTruth AI

Local RAG + offline voice advisory service. Answers farmer queries from a
ChromaDB vector knowledge base (agriculture PDFs), falling back to DuckDuckGo
web search when local context is missing or irrelevant. Also serves a fully
offline speech-to-text pipeline (Vosk) with gTTS spoken answers.

- Code: `app/` (`main.py`, `api.py`, `services/rag_service.py`)
- Port: **8001** natively (`127.0.0.1:8001`), `8000` inside Docker
- GPU-only embedding policy: embeddings load via `services/utils/model_loader.py`
  (`require_gpu`), which refuses to start without CUDA unless
  `REQUIRE_GPU=0` is set. No CPU fallback.

## Endpoints

All `/generate-truth` and `/voice-query` routes require the
`x-internal-api-key: <INTERNAL_API_KEY>` header (see
`services/shared/core/security.py`). `GET /` and `GET /health` are public.

| Method | Path             | Body                                    | Returns                          |
| ------ | ---------------- | --------------------------------------- | -------------------------------- |
| GET    | `/`, `/health`   | —                                       | `{"status":"ok","service":...}`  |
| POST   | `/generate-truth`| JSON `{"query": "<2–2000 chars>"}`      | JSON `{"answer": "..."}` (503 while the KB is still indexing, or when retrieval/LLM is down) |
| POST   | `/voice-query`   | multipart `audio_file` (≤ 15 MB; mp3/wav/ogg/webm/m4a) | `audio/mpeg` MP3 of the spoken answer (422 if audio unintelligible, 503 on RAG/voice failure) |

Pipeline per query: embed query → ChromaDB top-2 cosine search (threshold 0.4,
else web search) → local LLM via LiteLLM `ollama/<LOCAL_LLM_MODEL>` at
`OLLAMA_API_BASE_URL`. Document ingestion runs in a background thread at
startup (PDF text layer + Tesseract OCR on every page, `.txt`, images);
`get_response` returns 503 until indexing finishes.

## Required env

Sourced from root `.env` plus native overrides (see `scripts/dev.sh`).
`services/shared/core/config.py` *requires* DB settings at import even though
this service never queries Postgres — set one of them.

| Var | Purpose | Native value |
| --- | ------- | ------------ |
| `INTERNAL_API_KEY` | auth header for `/generate-truth`, `/voice-query` | from `.env` |
| `SECRET_KEY` | required by shared settings | from `.env` |
| `SUPABASE_DB_URL` (or `DATABASE_URL` / `POSTGRES_*`) | required by shared settings validator | from `.env` |
| `LOCAL_LLM_MODEL` | Ollama chat model (e.g. `qwen2.5vl:3b`) | from `.env` |
| `OLLAMA_API_BASE_URL` | Ollama endpoint | `http://localhost:11434` native (`http://ollama:11434` in Docker) |
| `EMBEDDING_MODEL_NAME` | SentenceTransformer model (e.g. `paraphrase-MiniLM-L3-v2`) | from `.env` |
| `HF_HOME` | embedding-model cache | `<root>/.local/hf_cache` (or `~/.cache/huggingface`) |
| `CHROMA_DB_PATH` | persistent vector store | `<root>/.local/chroma_db` (`/chroma_db` in Docker) |
| `KNOWLEDGE_DOCS_DIR` | source PDFs/text | `<root>/knowledge_documents` |
| `VOSK_MODEL_PATH` | offline STT model dir | `<root>/.local/vosk-model` (`/opt/vosk-model` in Docker) |
| `REQUIRE_GPU` | `1` (default) enforces CUDA for embeddings | `1` |
| `CORS_ORIGINS`, `ENVIRONMENT` | CORS allow-list, env label | from `.env` |
| `DATA_GOV_API_KEY` | optional | from `.env` |

Notes: `gTTS` (spoken answers) needs internet access. `download_docs.py`
syncs `knowledge_documents/` from `metadata.json` and builds `combined.pem`
from the certifi bundle + `govt.pem`; run it from this directory.

## Native run

From the repo root (root `.venv` replaces the legacy per-service venv):

```bash
cd services/groundtruth_ai
PYTHONPATH=/home/mukul/Main/Projects/Agri-Agentic-Suite/services \
CHROMA_DB_PATH=/home/mukul/Main/Projects/Agri-Agentic-Suite/.local/chroma_db \
KNOWLEDGE_DOCS_DIR=/home/mukul/Main/Projects/Agri-Agentic-Suite/knowledge_documents \
VOSK_MODEL_PATH=/home/mukul/Main/Projects/Agri-Agentic-Suite/.local/vosk-model \
HF_HOME=/home/mukul/Main/Projects/Agri-Agentic-Suite/.local/hf_cache \
/home/mukul/Main/Projects/Agri-Agentic-Suite/.venv/bin/python -m uvicorn app.main:app \
  --host 127.0.0.1 --port 8001
```

(`scripts/dev.sh` exports the same overrides plus `OLLAMA_API_BASE_URL`,
`MODEL_DIR`, `REQUIRE_GPU`.) Quick check:

```bash
curl -s http://localhost:8001/health
curl -s -X POST http://localhost:8001/generate-truth \
  -H 'Content-Type: application/json' \
  -H "x-internal-api-key: $INTERNAL_API_KEY" \
  -d '{"query":"What is soil organic carbon?"}'
```
