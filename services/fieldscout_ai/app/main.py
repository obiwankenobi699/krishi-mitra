from fastapi import FastAPI
from .api import router as vision_router
from fastapi.middleware.cors import CORSMiddleware
from shared.core.config import settings

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


def _weights_check() -> str:
    candidate = Path(settings.MODEL_DIR) / "yolo11-plant" / "plantvillage_yolo11x.onnx"
    if candidate.is_file():
        return "ok"
    return f"unavailable: missing {candidate}"

app = FastAPI(
    title="FieldScout AI - Prototype 3",
    description="On-device crop disease diagnosis.",
    version="0.1.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/", tags=["Health Check"])
def read_root():
    return {"status": "ok", "service": "FieldScout AI"}

@app.get("/health", tags=["Health Check"])
def health():
    checks = {
        "yolo_weights_present": _weights_check(),
        "ollama_reachable": _tcp_check(settings.OLLAMA_API_BASE_URL),
    }
    status = "ok" if all(v == "ok" for v in checks.values()) else "degraded"
    return {"status": status, "service": "FieldScout AI", "checks": checks}

app.include_router(vision_router)
print(f"🚀 FieldScout AI Service loaded in {settings.ENVIRONMENT} mode.")
