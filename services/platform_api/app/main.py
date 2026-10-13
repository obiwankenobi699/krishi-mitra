import asyncio
from contextlib import asynccontextmanager, suppress

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .news_ingest import news_loop
from .routers import ai, farms, marketplace, news, telegram
from .supabase import SupabaseGateway


@asynccontextmanager
async def lifespan(app: FastAPI):
    limits = httpx.Limits(max_connections=50, max_keepalive_connections=20)
    async with httpx.AsyncClient(limits=limits) as client:
        app.state.http = client
        app.state.supabase = SupabaseGateway(client)
        news_task = asyncio.create_task(news_loop(client, app.state.supabase))
        yield
        news_task.cancel()
        with suppress(asyncio.CancelledError):
            await news_task


app = FastAPI(
    title="Agri Agentic Platform API",
    description="Authenticated API gateway for farmer, marketplace, news, Telegram, and AI workflows.",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(ai.router)
app.include_router(farms.router)
app.include_router(marketplace.router)
app.include_router(news.router)
app.include_router(telegram.router)


@app.get("/health", tags=["Operations"])
async def health():
    import socket
    from urllib.parse import urlparse

    def _downstream_check(url: str) -> str:
        # Quick TCP socket peek only (1s timeout, no HTTP request).
        try:
            parts = urlparse(url)
            host = parts.hostname or "127.0.0.1"
            port = parts.port or 80
            with socket.create_connection((host, port), timeout=1.0):
                return "ok"
        except Exception as exc:
            return f"unavailable: {exc}"

    checks = {
        "groundtruth_reachable": _downstream_check(settings.groundtruth_url),
        "yieldwise_reachable": _downstream_check(settings.yieldwise_url),
        "fieldscout_reachable": _downstream_check(settings.fieldscout_url),
    }
    status = "ok" if all(v == "ok" for v in checks.values()) else "degraded"
    return {"status": status, "service": "platform-api", "checks": checks}
