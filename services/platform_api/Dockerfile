FROM ghcr.io/astral-sh/uv:0.9.15 AS uv
FROM python:3.11.14-slim

WORKDIR /app
COPY --from=uv /uv /uvx /bin/
COPY ./services/platform_api/requirements.lock /app/requirements.lock
RUN uv pip install --system --no-cache -r /app/requirements.lock

COPY ./services/platform_api/app /app/app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
