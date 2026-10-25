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

## Quick start

Krishi Mitra runs natively; Docker and WSL are not required. The setup scripts
install the pinned Node.js, pnpm, Python, and uv toolchain through mise, install
project dependencies, prepare local state, download the Vosk speech model, and
smoke-check services. Install the system tools listed for your operating system
before running setup.

### Windows 10/11 (PowerShell)

Run these commands from the repository root in PowerShell or Windows Terminal.
The Windows scripts are native PowerShell; Git Bash is not needed for the main
app.

1. Create and edit the local environment file:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

   Fill in the required Supabase values and application secrets. Telegram values
   are optional unless you want the bot; never commit `.env`.

2. Install system tools. Ollama, Tesseract OCR, and FFmpeg can be installed with
   `winget`:

   ```powershell
   winget install --id Ollama.Ollama -e
   winget install --id UB-Mannheim.TesseractOCR -e
   winget install --id Gyan.FFmpeg -e
   ```

   Install Poppler separately and add the folder containing `pdftoppm.exe` to
   `PATH` (for example, `choco install poppler -y` if Chocolatey is installed).
   Restart PowerShell after installing tools so the updated `PATH` is loaded.

3. Run setup. This direct command lets the script bootstrap mise before pnpm is
   available:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup.ps1
   ```

   If mise was just installed, open a fresh PowerShell window if setup asks you
   to refresh the shell. Then start the full stack:

   ```powershell
   pnpm run dev:windows
   ```

   Open <http://localhost:3000>. The gateway is on `:8000`; the AI services are
   on `:8001`–`:8003`. Press **Ctrl+C** in the launcher terminal to stop the
   stack. To run only the web app, use `pnpm run web:dev`.

Useful Windows checks and recovery commands:

```powershell
pnpm run doctor:windows
pnpm run restart:windows
pnpm run tg:poll:windows
```

`tg:poll:windows` runs the Telegram worker in the foreground; keep it running
in a second PowerShell window while the main stack is up.

### Linux (Ubuntu/Debian, Bash)

From the repository root, install the system packages and Ollama first:

```bash
sudo apt update
sudo apt install -y git curl unzip build-essential tesseract-ocr poppler-utils ffmpeg
curl -fsSL https://ollama.com/install.sh | sh
```

Create and edit `.env`, then run the native setup script. It bootstraps mise if
needed, installs the pinned toolchain and dependencies, prepares local state,
and checks service startup:

```bash
cp .env.example .env
nano .env
bash scripts/setup.sh
```

Start the full stack and open <http://localhost:3000>:

```bash
pnpm run dev
```

The gateway is on `:8000`; the AI services are on `:8001`–`:8003`. Press
**Ctrl+C** to stop. Run Telegram polling in a second terminal with
`pnpm run tg:poll`.

Useful Linux checks and recovery commands:

```bash
pnpm run doctor
pnpm run restart
pnpm run health
```

### GPU and model files

The full AI stack currently requires an NVIDIA GPU visible to `nvidia-smi` and
CUDA-enabled PyTorch. The launcher selects an efficient or performance tier
based on available VRAM. Ollama must have the model named by `LOCAL_LLM_MODEL`
in `.env`; check it with `ollama list`.

Large model assets are not committed to Git. Setup downloads the Vosk speech
model and the groundtruth service downloads/caches its MiniLM embedding model.
The FieldScout YOLO detector needs
`.local/models/yolo11-plant/plantvillage_yolo11x.onnx` and `labels.json`; stage
those files by following [`services/fieldscout_ai/README.md`](services/fieldscout_ai/README.md).
Without those weights, the web app can run while crop-image detection is
unavailable or falls back. `.local/` is intentionally ignored by Git.

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

## Environment configuration

Copy `.env.example` to `.env` and set the required values:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SECRET_KEY` and `INTERNAL_API_KEY` (use distinct, long random values)
- `LOCAL_LLM_MODEL` to the Ollama model installed on your machine

Optional values include `SUPABASE_DB_URL` (price-estimator training),
`DATA_GOV_API_KEY` (mandi-price data), and the Telegram settings below. Keep
service-role keys and all other secrets in `.env`; do not use them in
`NEXT_PUBLIC_*` variables or commit `.env`.

## Supabase setup

1. Create a project at supabase.com; copy URL + publishable + secret keys.
2. Apply both files in `supabase/migrations/` in order
   (`..._platform_foundation.sql`, then `..._telegram_chat_state.sql`)
   via the SQL editor.
3. Enable Google in Authentication → Providers; add `http://localhost:3000`
   as redirect URL.

## Telegram bot

Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, and
`TELEGRAM_WEBHOOK_SECRET` in `.env`. Apply both Supabase migrations listed
above. Keep the gateway running, then choose **one** update-delivery mode:

- **Polling (recommended for local development):** no public URL or Cloudflare
  tunnel is needed. Run `pnpm run tg:poll:windows` in a second PowerShell
  window, or `pnpm run tg:poll` in a second Linux terminal. Keep that process
  running while using the bot. Polling disables any existing webhook because
  Telegram does not allow polling and webhook delivery at the same time.
- **Webhook (public endpoint):** install `cloudflared`, then run
  `cloudflared tunnel --url http://localhost:8000` in a separate terminal. Copy
  the HTTPS `trycloudflare.com` URL it prints and, from a Bash shell with the
  project dependencies available, run:
  `bash scripts/setup-telegram.sh https://your-tunnel.trycloudflare.com`.
  Keep the tunnel process running. If its temporary URL changes, run the setup
  command again with the new URL. Do not run the polling worker in webhook mode.

Cloudflare is only needed for webhook delivery from outside your machine. It is
not part of `dev:windows` or `dev`, and it is not needed when using polling.
The bot token is a credential; do not paste it into logs, issues, or screenshots.

## Troubleshooting

- **Missing `tesseract`, `ffmpeg`, or `pdftoppm`:** install the operating
  system tools above, restart the terminal, then rerun setup.
- **`.venv` or `node_modules` missing:** rerun the platform setup script.
- **Ollama model unavailable:** run `ollama list`, then pull or create the model
  named by `LOCAL_LLM_MODEL` in `.env`.
- **Crop diagnosis has no local detections:** stage the YOLO files described in
  the FieldScout README; the model weights are not included in Git.
- **Telegram does not respond:** verify the three `TELEGRAM_*` values, confirm
  the gateway health endpoint at <http://localhost:8000/health>, and keep the
  selected polling worker or Cloudflare tunnel running.
- **A port is already in use:** stop the existing project process before
  starting another copy. On Windows, `pnpm run restart:windows` frees project
  ports before relaunching.

## Development commands

```bash
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm run test
pnpm run python:check
```

## License

MIT — see [LICENSE](LICENSE).
