import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

from ..config import settings
from ..news_ingest import refresh_news
from ..schemas import NewsIngestRequest
from ..supabase import SupabaseGateway, get_gateway


router = APIRouter(prefix="/news", tags=["News"])


@router.get("")
async def list_news(
    category: str | None = Query(default=None, max_length=50),
    state_name: str | None = Query(default=None, alias="state", max_length=100),
    limit: int = Query(default=30, ge=1, le=100),
    gateway: SupabaseGateway = Depends(get_gateway),
):
    params = {"select": "*", "order": "published_at.desc", "limit": str(limit)}
    if category:
        params["category"] = f"eq.{category}"
    if state_name:
        params["or"] = f"(state.is.null,state.eq.{state_name})"
    return await gateway.table("news_articles", params=params)


@router.post("/refresh", include_in_schema=False)
async def refresh_news_now(
    body: NewsIngestRequest,
    request: Request,
    x_internal_api_key: str | None = Header(default=None),
    gateway: SupabaseGateway = Depends(get_gateway),
):
    if not x_internal_api_key or not secrets.compare_digest(
        x_internal_api_key, settings.internal_api_key
    ):
        raise HTTPException(status_code=403, detail="Invalid internal API key")
    feeds = body.feed_urls if body.feed_urls is not None else settings.feeds
    if any(feed not in settings.feeds for feed in feeds):
        raise HTTPException(status_code=422, detail="Only configured news feeds can be refreshed")
    count = await refresh_news(request.app.state.http, gateway, feeds)
    return {"ingested": count}
