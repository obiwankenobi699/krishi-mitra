import secrets

from fastapi import Header, HTTPException, status

from shared.core.config import settings


async def require_internal_api_key(
    x_internal_api_key: str | None = Header(default=None),
) -> None:
    """Authenticate server-to-server calls to the private AI services."""
    if not x_internal_api_key or not secrets.compare_digest(
        x_internal_api_key, settings.INTERNAL_API_KEY
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing internal API key",
        )
