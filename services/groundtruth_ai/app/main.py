# from fastapi import FastAPI
# from fastapi.responses import PlainTextResponse
# from .api import router as sms_router
# from shared.core.config import settings

# app = FastAPI(
#     title="GroundTruth AI - Prototype 1",
#     description="Accessible agricultural advice via SMS.",
#     version="0.1.0"
# )

# @app.get("/", tags=["Health Check"])
# def read_root():
#     """A simple health check endpoint."""
#     return {"status": "ok", "service": "GroundTruth AI"}

# # Override the default response class for the Twilio endpoint
# # This ensures the Content-Type header is 'text/xml' as required by Twilio.
# app.include_router(sms_router, default_response_class=PlainTextResponse)

# print(f"🚀 GroundTruth AI Service loaded in {settings.ENVIRONMENT} mode.")


from fastapi import FastAPI
from .api import router as query_router
from shared.core.config import settings
from fastapi.middleware.cors import CORSMiddleware

import os
import socket
from pathlib import Path
from urllib.parse import urlparse


def _tcp_check(url: str) -> str:
    """Cheap localhost socket peek (1s timeout, no HTTP, no model load)."""
    try:
        parts = urlparse(url)
        host = parts.hostname or "127.0.0.1"
        port = parts.port or 80
        with socket.create_connection((host, port), timeout=1.0):
            return "ok"
    except Exception as exc:
        return f"unavailable: {exc}"


def _chroma_check() -> str:
    path = Path(settings.CHROMA_DB_PATH)
    try:
        path.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        return f"unavailable: {exc}"
    if os.access(path, os.W_OK):
        return "ok"
    return f"unavailable: not writable: {path}"

app = FastAPI(
    title="GroundTruth AI - Prototype 1",
    description="Accessible agricultural advice via local RAG.",
    version="0.2.0"
)

#(Note: For production, you would restrict allow_origins to your specific frontend domain, but "*" is fine for development.)
# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

@app.get("/", tags=["Health Check"])
def read_root():
    return {"status": "ok", "service": "GroundTruth AI"}

@app.get("/health", tags=["Health Check"])
def health():
    checks = {
        "chroma_dir_writable": _chroma_check(),
        "ollama_reachable": _tcp_check(settings.OLLAMA_API_BASE_URL),
    }
    status = "ok" if all(v == "ok" for v in checks.values()) else "degraded"
    return {"status": status, "service": "GroundTruth AI", "checks": checks}

app.include_router(query_router)

print(f"🚀 GroundTruth AI Service loaded in {settings.ENVIRONMENT} mode.")
