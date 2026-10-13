from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status

from ..dependencies import current_user
from ..schemas import CurrentUser, FarmCreate, FarmUpdate
from ..supabase import SupabaseGateway, get_gateway


router = APIRouter(prefix="/farms", tags=["Farms"])


async def _owned_farm(farm_id: UUID, user: CurrentUser, gateway: SupabaseGateway) -> dict:
    rows = await gateway.table(
        "farms",
        token=user.access_token,
        params={"select": "*", "id": f"eq.{farm_id}", "owner_id": f"eq.{user.id}", "limit": "1"},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Farm not found")
    return rows[0]


@router.get("")
async def list_farms(
    user: CurrentUser = Depends(current_user), gateway: SupabaseGateway = Depends(get_gateway)
):
    return await gateway.table(
        "farms",
        token=user.access_token,
        params={"select": "*", "owner_id": f"eq.{user.id}", "order": "created_at.desc"},
    )


@router.get("/{farm_id}")
async def get_farm(
    farm_id: UUID,
    user: CurrentUser = Depends(current_user),
    gateway: SupabaseGateway = Depends(get_gateway),
):
    return await _owned_farm(farm_id, user, gateway)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_farm(
    farm: FarmCreate,
    user: CurrentUser = Depends(current_user),
    gateway: SupabaseGateway = Depends(get_gateway),
):
    payload = farm.model_dump(mode="json") | {"owner_id": str(user.id)}
    rows = await gateway.table(
        "farms",
        method="POST",
        token=user.access_token,
        payload=payload,
        prefer="return=representation",
    )
    if not rows:
        raise HTTPException(status_code=502, detail="Database request failed")
    return rows[0]


@router.patch("/{farm_id}")
async def update_farm(
    farm_id: UUID,
    update: FarmUpdate,
    user: CurrentUser = Depends(current_user),
    gateway: SupabaseGateway = Depends(get_gateway),
):
    await _owned_farm(farm_id, user, gateway)
    rows = await gateway.table(
        "farms",
        method="PATCH",
        token=user.access_token,
        params={"id": f"eq.{farm_id}", "owner_id": f"eq.{user.id}"},
        payload=update.model_dump(mode="json", exclude_unset=True),
        prefer="return=representation",
    )
    if not rows:
        raise HTTPException(status_code=502, detail="Database request failed")
    return rows[0]


@router.delete("/{farm_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_farm(
    farm_id: UUID,
    user: CurrentUser = Depends(current_user),
    gateway: SupabaseGateway = Depends(get_gateway),
):
    await _owned_farm(farm_id, user, gateway)
    await gateway.table(
        "farms",
        method="DELETE",
        token=user.access_token,
        params={"id": f"eq.{farm_id}", "owner_id": f"eq.{user.id}"},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
