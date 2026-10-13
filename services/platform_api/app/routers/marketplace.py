import re
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status

from ..dependencies import current_user
from ..schemas import CurrentUser, ListingCreate, ListingUpdate
from ..services.uploads import read_limited, validate_image
from ..supabase import SupabaseGateway, get_gateway


router = APIRouter(prefix="/marketplace", tags=["Marketplace"])
SAFE_FILTER = re.compile(r"^[\w\s.-]+$", re.UNICODE)


def _filter(value: str | None, name: str) -> str | None:
    if value and not SAFE_FILTER.fullmatch(value):
        raise HTTPException(status_code=422, detail=f"Invalid {name} filter")
    return value


async def _owned_listing(listing_id: UUID, user: CurrentUser, gateway: SupabaseGateway) -> dict:
    rows = await gateway.table(
        "listings",
        token=user.access_token,
        params={"select": "*", "id": f"eq.{listing_id}", "owner_id": f"eq.{user.id}", "limit": "1"},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Listing not found")
    return rows[0]


@router.get("")
async def list_marketplace(
    crop: str | None = Query(default=None, max_length=80),
    state_name: str | None = Query(default=None, alias="state", max_length=100),
    district: str | None = Query(default=None, max_length=100),
    search: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10_000),
    gateway: SupabaseGateway = Depends(get_gateway),
):
    crop, state_name = _filter(crop, "crop"), _filter(state_name, "state")
    district, search = _filter(district, "district"), _filter(search, "search")
    params = {
        "select": "*",
        "status": "eq.active",
        "order": "created_at.desc",
        "limit": str(limit),
        "offset": str(offset),
    }
    if crop:
        params["crop"] = f"ilike.*{crop}*"
    if state_name:
        params["state"] = f"eq.{state_name}"
    if district:
        params["district"] = f"eq.{district}"
    if search:
        params["or"] = f"(title.ilike.*{search}*,crop.ilike.*{search}*)"
    return await gateway.table("listings", params=params)


@router.get("/mine")
async def my_listings(
    user: CurrentUser = Depends(current_user), gateway: SupabaseGateway = Depends(get_gateway)
):
    return await gateway.table(
        "listings",
        token=user.access_token,
        params={"select": "*", "owner_id": f"eq.{user.id}", "order": "created_at.desc"},
    )


@router.get("/{listing_id}")
async def get_listing(listing_id: UUID, gateway: SupabaseGateway = Depends(get_gateway)):
    rows = await gateway.table(
        "listings",
        params={"select": "*", "id": f"eq.{listing_id}", "status": "eq.active", "limit": "1"},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Listing not found")
    return rows[0]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_listing(
    listing: ListingCreate,
    user: CurrentUser = Depends(current_user),
    gateway: SupabaseGateway = Depends(get_gateway),
):
    seller_name = (
        user.user_metadata.get("full_name")
        or user.user_metadata.get("name")
        or (user.email or "Farmer").split("@")[0]
    )
    payload = listing.model_dump(mode="json") | {
        "owner_id": str(user.id),
        "seller_name": seller_name,
    }
    rows = await gateway.table(
        "listings",
        method="POST",
        token=user.access_token,
        payload=payload,
        prefer="return=representation",
    )
    if not rows:
        raise HTTPException(status_code=502, detail="Database request failed")
    return rows[0]


@router.post("/{listing_id}/images", status_code=status.HTTP_201_CREATED)
async def upload_listing_image(
    listing_id: UUID,
    image: UploadFile = File(...),
    user: CurrentUser = Depends(current_user),
    gateway: SupabaseGateway = Depends(get_gateway),
):
    listing = await _owned_listing(listing_id, user, gateway)
    paths = listing.get("image_paths") or []
    if len(paths) >= 8:
        raise HTTPException(status_code=409, detail="A listing can have at most 8 images")
    content = await read_limited(image)
    extension = validate_image(content, image.content_type)
    path = f"{user.id}/{listing_id}/{uuid4()}{extension}"
    await gateway.upload(
        "marketplace-images", path, content, image.content_type, token=user.access_token
    )
    try:
        rows = await gateway.table(
            "listings",
            method="PATCH",
            token=user.access_token,
            params={"id": f"eq.{listing_id}", "owner_id": f"eq.{user.id}"},
            payload={"image_paths": [*paths, path]},
            prefer="return=representation",
        )
    except HTTPException:
        await gateway.remove("marketplace-images", [path], token=user.access_token)
        raise
    if not rows:
        await gateway.remove("marketplace-images", [path], token=user.access_token)
        raise HTTPException(status_code=502, detail="Database request failed")
    return rows[0]


@router.patch("/{listing_id}")
async def update_listing(
    listing_id: UUID,
    update: ListingUpdate,
    user: CurrentUser = Depends(current_user),
    gateway: SupabaseGateway = Depends(get_gateway),
):
    await _owned_listing(listing_id, user, gateway)
    rows = await gateway.table(
        "listings",
        method="PATCH",
        token=user.access_token,
        params={"id": f"eq.{listing_id}", "owner_id": f"eq.{user.id}"},
        payload=update.model_dump(mode="json", exclude_unset=True),
        prefer="return=representation",
    )
    if not rows:
        raise HTTPException(status_code=502, detail="Database request failed")
    return rows[0]


@router.delete("/{listing_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_listing(
    listing_id: UUID,
    user: CurrentUser = Depends(current_user),
    gateway: SupabaseGateway = Depends(get_gateway),
):
    listing = await _owned_listing(listing_id, user, gateway)
    await gateway.table(
        "listings",
        method="DELETE",
        token=user.access_token,
        params={"id": f"eq.{listing_id}", "owner_id": f"eq.{user.id}"},
    )
    await gateway.remove(
        "marketplace-images", listing.get("image_paths") or [], token=user.access_token
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
