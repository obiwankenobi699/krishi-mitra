from typing import Any
from urllib.parse import quote

import httpx
from fastapi import HTTPException, Request, status

from .config import settings


class SupabaseGateway:
    def __init__(self, client: httpx.AsyncClient):
        self.client = client
        self.base_url = settings.supabase_url.rstrip("/")

    def _headers(self, token: str, prefer: str | None = None, api_key: str | None = None) -> dict[str, str]:
        # New sb_* keys require apikey to match the credential: publishable
        # for user calls, secret for service calls. Mixing them 401s.
        headers = {
            "apikey": api_key or settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    async def authenticate(self, token: str) -> dict[str, Any]:
        try:
            response = await self.client.get(
                f"{self.base_url}/auth/v1/user", headers=self._headers(token), timeout=10
            )
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=503, detail="Authentication service is unavailable"
            ) from exc
        if response.status_code != status.HTTP_200_OK:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session"
            )
        return response.json()

    async def table(
        self,
        table: str,
        *,
        method: str = "GET",
        token: str | None = None,
        params: dict[str, str] | None = None,
        payload: Any = None,
        prefer: str | None = None,
        service: bool = False,
    ) -> Any:
        credential = (
            settings.supabase_secret_key
            if service
            else (token or settings.supabase_publishable_key)
        )
        if service and not credential:
            raise HTTPException(status_code=503, detail="Supabase secret key is not configured")
        try:
            response = await self.client.request(
                method,
                f"{self.base_url}/rest/v1/{table}",
                headers=self._headers(
                    credential,
                    prefer,
                    api_key=settings.supabase_secret_key if service else None,
                ),
                params=params,
                json=payload,
                timeout=20,
            )
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=503, detail="Database service is unavailable") from exc
        if response.status_code >= 400:
            if response.status_code in {401, 403}:
                raise HTTPException(
                    status_code=response.status_code, detail="Database access denied"
                )
            if response.status_code == 409:
                raise HTTPException(status_code=409, detail="Resource already exists")
            raise HTTPException(status_code=502, detail="Database request failed")
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    async def upload(
        self,
        bucket: str,
        path: str,
        content: bytes,
        content_type: str,
        *,
        token: str | None = None,
        service: bool = False,
    ) -> str:
        credential = settings.supabase_secret_key if service else token
        if not credential:
            raise HTTPException(status_code=503, detail="Storage credentials are not configured")
        safe_path = "/".join(quote(part, safe="") for part in path.split("/"))
        try:
            response = await self.client.post(
                f"{self.base_url}/storage/v1/object/{bucket}/{safe_path}",
                headers={
                    **self._headers(
                        credential,
                        api_key=settings.supabase_secret_key if service else None,
                    ),
                    "Content-Type": content_type,
                    "x-upsert": "false",
                },
                content=content,
                timeout=30,
            )
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=503, detail="Storage service is unavailable") from exc
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="Image upload failed")
        return path

    async def remove(
        self,
        bucket: str,
        paths: list[str],
        *,
        token: str | None = None,
        service: bool = False,
    ) -> None:
        if not paths:
            return
        credential = settings.supabase_secret_key if service else token
        if not credential:
            raise HTTPException(status_code=503, detail="Storage credentials are not configured")
        try:
            response = await self.client.request(
                "DELETE",
                f"{self.base_url}/storage/v1/object/{bucket}",
                headers=self._headers(
                    credential,
                    api_key=settings.supabase_secret_key if service else None,
                ),
                json={"prefixes": paths},
                timeout=30,
            )
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=503, detail="Storage service is unavailable") from exc
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail="Image removal failed")


def get_gateway(request: Request) -> SupabaseGateway:
    return request.app.state.supabase
