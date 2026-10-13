from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .schemas import CurrentUser
from .supabase import SupabaseGateway, get_gateway


bearer = HTTPBearer(auto_error=False)


async def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    gateway: SupabaseGateway = Depends(get_gateway),
) -> CurrentUser:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in required")
    payload = await gateway.authenticate(credentials.credentials)
    if not payload.get("id"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session user")
    return CurrentUser(
        id=payload["id"],
        email=payload.get("email"),
        user_metadata=payload.get("user_metadata") or {},
        access_token=credentials.credentials,
    )
