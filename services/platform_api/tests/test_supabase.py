import httpx
import pytest
from fastapi import HTTPException

from app.supabase import SupabaseGateway


@pytest.mark.anyio
async def test_authenticate_forwards_google_session_jwt(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers["authorization"]
        return httpx.Response(200, json={"id": "43ce3eb1-c41c-4427-9fe0-64bdba40cd2d"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        gateway = SupabaseGateway(client)
        user = await gateway.authenticate("google-session-jwt")

    assert user["id"] == "43ce3eb1-c41c-4427-9fe0-64bdba40cd2d"
    assert seen["authorization"] == "Bearer google-session-jwt"


@pytest.mark.anyio
async def test_authenticate_rejects_invalid_session():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        gateway = SupabaseGateway(client)
        with pytest.raises(HTTPException) as exc:
            await gateway.authenticate("invalid")

    assert exc.value.status_code == 401


@pytest.mark.anyio
async def test_table_forwards_user_token_for_rls():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers["authorization"]
        return httpx.Response(200, json=[])

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        gateway = SupabaseGateway(client)
        await gateway.table("farms", token="session-jwt")

    assert seen["authorization"] == "Bearer session-jwt"
