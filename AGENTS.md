# Repository Guidelines

## Project Structure & Module Organization

This Docker Compose monorepo uses a root-level Next.js App Router frontend. Route files live in `src/app/`, shared UI in `src/components/`, browser helpers in `src/lib/`, and static assets in `public/`. `services/platform_api/` is the authenticated gateway; `groundtruth_ai`, `yieldwise`, and `fieldscout_ai` provide RAG, finance, and vision capabilities. Shared Python utilities belong in `services/shared/`. Supabase migrations live in `supabase/migrations/`, reference documents in `knowledge_documents/`, and the IEEE project paper in `docs/`.

## Build, Test, and Development Commands

- `pnpm run dev`: build and launch Ollama, all APIs, and the web app.
- `pnpm run web:dev`: run only Next.js at `http://localhost:3000`.
- `pnpm run dev:down`: stop the Compose stack without deleting volumes.
- `pnpm run lint` / `pnpm run build`: validate frontend style and production output.
- `pnpm run test`: run Python tests through uv.
- `pnpm run python:check`: run Ruff against the Python services.

Copy the environment values documented in `README.md` into a root `.env` before starting the full stack.

## Coding Style & Naming Conventions

Follow surrounding code and keep changes service-local. Python uses four spaces, `snake_case` modules/functions, and `PascalCase` Pydantic models. JavaScript uses two spaces, functional components, `PascalCase` components, and `camelCase` variables. Use lowercase route folders such as `src/app/crop-doctor/`. ESLint and Ruff are the configured checks.

## Testing Guidelines

Backend tests live beside each service in `services/*/tests/` and use pytest names such as `test_marketplace.py`. Add focused tests for validation, authorization, and failure paths. For UI changes, run lint and build, then manually exercise the affected route. No coverage threshold is enforced.

## Commit & Pull Request Guidelines

History mostly uses brief messages such as `updates`; prefer descriptive, imperative subjects such as `fix fieldscout image validation`. Keep commits focused. Pull requests should explain the problem and solution, list validation commands, link issues, and include screenshots for UI changes. Call out model downloads, schema changes, or new environment variables.

## Security & Configuration

Never commit `.env`, API keys, database passwords, generated model data, or uploads. Only publishable Supabase values may use `NEXT_PUBLIC_`; secret/service-role keys stay server-side. Apply database changes through reviewed files in `supabase/migrations/` and retain RLS on every exposed table.
