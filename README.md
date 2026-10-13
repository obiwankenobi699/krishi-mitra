# Krishi Mitra — Agri-Agentic Suite

A local-first farmer platform: crop disease diagnosis from photos, field vigor
maps with 3D canopy view, zone-wise crop planning, farm financial advice,
a farmer marketplace, news, and a Telegram bot — all running on your own GPU,
with Supabase cloud for data.

## Features

| Area | Status |
|---|---|
| Crop Doctor — YOLOv11x disease detection (116 classes), SVG overlays | ✅ live, ~0.1s |
| Field analysis — vigor heatmap, 3D canopy, zone crop plans (season + yield/money goals) | ✅ live |
| Yield Advisor chat + financial plans (local LLM + RAG) | ✅ live |
| Farmer marketplace with photos + call-the-farmer buttons | ✅ live, seeded |
| Farms, diagnoses history, news | ✅ live |
| Telegram bot (`/diagnos`, `/market`, `/link`) with DB-backed chat state | ✅ live via webhook or polling |
| Price training from data.gov.in | needs `SUPABASE_DB_URL` pooler password |

## Stack

- **Web:** Next.js 15 App Router, React 19, TypeScript (strict), Tailwind CSS v4,
  React Three Fiber (3D canopy), Fraunces + Inter
- **Gateway:** FastAPI (`services/platform_api`, port 8000)
- **AI services:** `groundtruth_ai` RAG+embeddings (:8001), `yieldwise`
  finance (:8002), `fieldscout_ai` vision (:8003) — one shared root venv
- **Models (all local, open weights):** YOLOv11x-ONNX detector (MIT),
  `qwen25-3b-farm` LLM, MiniLM embeddings, Vosk STT model
- **Data:** Supabase (Postgres + Auth + Storage, RLS on everything)
- **Tooling:** mise (pinned Node/pnpm/Python/uv), pnpm, uv, Ollama native

## Start locally (no Docker needed)

```bash
cp .env.example .env   # fill Supabase URL + keys (see Supabase setup)
pnpm install
pnpm run setup         # bootstraps mise, installs everything, smoke-tests boot
pnpm run dev           # web :3000, gateway :8000, AI :8001-8003
pnpm run health        # 16 checks — everything green?
```

Windows PowerShell twins: `setup:windows`, `dev:windows`, `restart:windows`,
`doctor:windows`, `tg:poll:windows`. Recovery: `pnpm run restart`,
audit anytime: `pnpm run doctor`. Telegram polling (no tunnel):
`pnpm run tg:poll`. Full bot setup: `bash scripts/setup-telegram.sh <url>`.

GPU tiers are automatic: 4GB cards run YOLO on CPU + sequential LLM
(efficient); 6GB+ unlocks YOLO on CUDA + parallel LLM (performance).

## Project layout

```text
src/app/            Next.js routes (landing, crop-doctor, field-analysis,
                    advisor, marketplace, farms, news, telegram, diagnoses)
src/components/     UI kit (ui.tsx), overlays, 3D canopy, header/footer
src/lib/            API client, Supabase client, canopy helpers
public/images/      web + listing imagery
services/platform_api/   authenticated gateway (routers/, services/)
services/groundtruth_ai/ RAG + voice + knowledge ingestion
services/yieldwise/      financial plans + price estimator training
services/fieldscout_ai/  YOLO detector, ResNet fallback, vigor maps
services/shared/    settings, auth, uploads used by all services
supabase/migrations/     schema, RLS, storage buckets (applied via MCP)
scripts/            setup/dev/restart/doctor/health + Telegram tooling
knowledge_documents/     RAG source docs (10MB, committed for offline setup)
```

## Environment

Copy `.env.example` to `.env`. Required: `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `INTERNAL_API_KEY`,
`SECRET_KEY`, plus `NEXT_PUBLIC_SUPABASE_*` twins. Optional until needed:
`SUPABASE_DB_URL` (price training), `DATA_GOV_API_KEY` (free, mandi prices),
`TELEGRAM_*` (bot). Never commit `.env`.

## Supabase setup

1. Create a project at supabase.com; copy URL + publishable + secret keys.
2. Apply both files in `supabase/migrations/` in order
   (`..._platform_foundation.sql`, then `..._telegram_chat_state.sql`)
   via the SQL editor.
3. Enable Google in Authentication → Providers; add `http://localhost:3000`
   as redirect URL.

## Useful commands

```bash
pnpm run lint / typecheck / build   # frontend gates
pnpm run test / python:check        # pytest + ruff
pnpm run dev:docker                 # deploy-parity compose stack (optional)
```

## License

MIT — see [LICENSE](LICENSE).
