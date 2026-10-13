# Platform API (gateway, :8000)

Authenticated gateway for the Agri Agentic Suite. It owns auth
(Supabase JWT → `X-Internal-API-Key` downstream), farmer/marketplace/news
CRUD via Supabase PostgREST, Telegram bot flows, and fan-out to the
`groundtruth_ai` (:8001), `yieldwise` (:8002), and `fieldscout_ai` (:8003)
services. The frontend (`src/lib/api.ts`) talks only to this service.

## Layout

- `app/main.py` — app factory, lifespan (shared `httpx.AsyncClient`,
  `SupabaseGateway`, background news loop), CORS, `/health`.
- `app/config.py` — `Settings` (env-driven). Importing `app.main`
  requires the env vars below to be set.
- `app/routers/` — `ai`, `farms`, `marketplace`, `news`, `telegram`.
- `app/services/` — `ai.py` (upstream fan-out, fusion fallback),
  `uploads.py` (size/type image + audio validation).
- `app/supabase.py` — `SupabaseGateway` (PostgREST / storage proxy,
  user-JWT or service-role credentials).
- `app/news_ingest.py` — RSS/Atom parsing + background refresh.
- `tests/` — pytest suite (`conftest.py` seeds dummy env).

## Key routes

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/health` | none | liveness probe |
| POST | `/ai/query` | Bearer JWT | → groundtruth `/generate-truth` |
| POST | `/ai/plan` | Bearer JWT | → yieldwise `/generate-plan` |
| POST | `/ai/voice` | Bearer JWT (+ audio file) | → groundtruth `/voice-query`, returns audio |
| POST | `/ai/diagnose` | Bearer JWT (+ image) | → fieldscout, persists `diagnoses` row with `image_path='ephemeral'` |
| GET | `/ai/diagnoses` | Bearer JWT | own diagnosis history |
| GET/POST | `/farms`, `/farms/{farm_id}` | Bearer JWT | owner-scoped CRUD |
| GET | `/marketplace`, `/marketplace/mine`, `/marketplace/{listing_id}` | public / JWT for `/mine` | active listings, filters |
| POST | `/marketplace`, `/marketplace/{listing_id}/images` | Bearer JWT | create + upload (≤8 images) |
| PATCH/DELETE | `/marketplace/{listing_id}` | Bearer JWT | owner only |
| GET | `/news` | public | `news_articles` feed |
| POST | `/news/refresh` | `X-Internal-API-Key` (hidden from OpenAPI) | allow-listed feeds only |
| GET/POST/DELETE | `/telegram/account`, `/telegram/link` | Bearer JWT | link-token flow |
| POST | `/telegram/webhook` | `X-Telegram-Bot-Api-Secret-Token` (hidden from OpenAPI) | background processing |

Auth model: every user route validates the Supabase session JWT via
`GET {SUPABASE_URL}/auth/v1/user`; downstream calls use
`X-Internal-API-Key`. Do not change this without a cross-service review.

## Required env vars

| Var | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | anon/publishable key (RLS user calls) |
| `INTERNAL_API_KEY` | downstream + `/news/refresh` shared secret |
| `SUPABASE_SECRET_KEY` | service-role key (news ingest, Telegram jobs) |
| `GROUNDTRUTH_URL` / `YIELDWISE_URL` / `FIELDSCOUT_URL` | downstream bases (default `http://localhost:8001/8002/8003`) |
| `FRONTEND_ORIGIN` | CORS origin (default `http://localhost:3000`) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` / `TELEGRAM_WEBHOOK_SECRET` | Telegram integration |
| `NEWS_FEED_URLS` / `NEWS_REFRESH_MINUTES` | ingest config |
| `MAX_UPLOAD_BYTES` / `UPSTREAM_TIMEOUT_SECONDS` | limits |

## Run natively (root venv)

From `services/platform_api`:

```bash
PYTHONPATH=services .venv/bin/python -m uvicorn app.main:app --port 8000
```

(`PYTHONPATH` must point at the repo `services/` dir when run from
elsewhere; the gateway is live on `:8000` — do not restart it
unannounced.) Tests: `uv run python -m pytest services/platform_api/tests -x -q`
from the repo root.
