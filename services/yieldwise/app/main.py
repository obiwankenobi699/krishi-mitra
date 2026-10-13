from fastapi import FastAPI
from .api import router as finance_router
from fastapi.middleware.cors import CORSMiddleware
from shared.core.config import settings

from pathlib import Path


def _models_check() -> str:
    model_dir = Path(settings.MODEL_DIR)
    missing = [name for name in ("price_estimator.pkl", "model_features.json") if not (model_dir / name).is_file()]
    if not missing:
        return "ok"
    return f"unavailable: missing {', '.join(missing)} in {model_dir}"


def _db_check() -> str:
    # Env configured only — never connect from a health probe.
    if getattr(settings, "DATABASE_URL", None):
        return "ok"
    return "unavailable: DATABASE_URL not configured"

app = FastAPI(
    title="YieldWise - Prototype 2",
    description="Financial planning and strategy for agriculture.",
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
    return {"status": "ok", "service": "YieldWise"}

@app.get("/health", tags=["Health Check"])
def health():
    checks = {
        "models_present": _models_check(),
        "db_configured": _db_check(),
    }
    status = "ok" if all(v == "ok" for v in checks.values()) else "degraded"
    return {"status": status, "service": "YieldWise", "checks": checks}

app.include_router(finance_router)
print(f"🚀 YieldWise Service loaded in {settings.ENVIRONMENT} mode.")
