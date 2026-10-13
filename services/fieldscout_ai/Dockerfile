FROM ghcr.io/astral-sh/uv:0.9.15 AS uv
FROM python:3.11.14-slim

WORKDIR /app
COPY --from=uv /uv /uvx /bin/
COPY ./services/fieldscout_ai/requirements.lock /app/requirements.lock
RUN uv pip install --system --no-cache -r /app/requirements.lock

COPY ./services/shared /app/shared
COPY ./services/fieldscout_ai/app /app/app

EXPOSE 8000
