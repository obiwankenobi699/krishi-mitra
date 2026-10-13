from pathlib import Path
from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import Response

from ..config import settings
from ..dependencies import current_user
from ..schemas import CurrentUser, FieldPlanRequest, FieldPlanResponse, FieldPlanZone, PlanRequest, QueryRequest
from ..services.ai import analyze_image, database_severity, extract_analysis, field_vigor_map, fuse_insight, plan_field_crops, request_json
from ..services.uploads import ALLOWED_AUDIO_TYPES, read_limited, validate_image
from ..supabase import SupabaseGateway, get_gateway

import logging
import os
import tempfile
import time
import uuid

logger = logging.getLogger(__name__)

_STAGING_TTL_SECONDS = 3600


def _staging_dir() -> Path | None:
    """Upload staging folder (auto-created). None if unavailable — analysis proceeds anyway."""
    configured = os.environ.get("UPLOAD_STAGING_DIR", "")
    target = Path(configured) if configured else Path(tempfile.gettempdir()) / "agraya-uploads"
    try:
        target.mkdir(parents=True, exist_ok=True)
        return target
    except OSError:
        logger.warning("Upload staging unavailable at %s", target)
        return None


def _sweep_stale_staged(directory: Path) -> None:
    """Best-effort delete of staged files older than TTL (crash leftovers)."""
    cutoff = time.time() - _STAGING_TTL_SECONDS
    try:
        for child in directory.iterdir():
            if child.is_file() and child.stat().st_mtime < cutoff:
                child.unlink(missing_ok=True)
    except OSError:
        pass


def _stage_upload(directory: Path, content: bytes, suffix: str) -> Path | None:
    path = directory / f"{uuid.uuid4().hex}{suffix}"
    try:
        path.write_bytes(content)
        return path
    except OSError:
        logger.warning("Could not stage upload at %s", path)
        return None


def _unstage(path: Path | None) -> None:
    if path is None:
        return
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


router = APIRouter(prefix="/ai", tags=["AI"])


@router.post("/query")
async def agricultural_query(
    body: QueryRequest,
    request: Request,
    user: CurrentUser = Depends(current_user),
):
    del user
    return await request_json(
        request.app.state.http,
        "POST",
        f"{settings.groundtruth_url}/generate-truth",
        unavailable_message="Agricultural assistant is unavailable",
        json=body.model_dump(),
    )


@router.post("/plan")
async def financial_plan(
    body: PlanRequest,
    request: Request,
    user: CurrentUser = Depends(current_user),
):
    del user
    return await request_json(
        request.app.state.http,
        "POST",
        f"{settings.yieldwise_url}/generate-plan",
        unavailable_message="Financial planner is unavailable",
        json=body.model_dump(),
    )


@router.post("/voice")
async def voice_query(
    request: Request,
    audio_file: UploadFile = File(...),
    user: CurrentUser = Depends(current_user),
):
    del user
    if audio_file.content_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported audio format")
    content = await read_limited(audio_file)
    try:
        response = await request.app.state.http.post(
            f"{settings.groundtruth_url}/voice-query",
            headers={"X-Internal-API-Key": settings.internal_api_key},
            files={
                "audio_file": (
                    Path(audio_file.filename or "voice.mp3").name,
                    content,
                    audio_file.content_type,
                )
            },
            timeout=settings.upstream_timeout_seconds,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        upstream_status = exc.response.status_code
        if upstream_status == 422:
            # Downstream could not understand the audio; surface a safe,
            # user-actionable message (downstream detail carries no traceback).
            try:
                detail = exc.response.json().get("detail") or "Could not understand the audio"
            except ValueError:
                detail = "Could not understand the audio"
            raise HTTPException(status_code=422, detail=detail) from exc
        if upstream_status in (502, 503, 504):
            raise HTTPException(
                status_code=upstream_status, detail="Voice assistant is unavailable"
            ) from exc
        raise HTTPException(status_code=502, detail="Voice assistant is unavailable") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Voice assistant is unavailable") from exc
    return Response(
        content=response.content, media_type=response.headers.get("content-type", "audio/mpeg")
    )


@router.post("/diagnose", status_code=status.HTTP_201_CREATED)
async def diagnose(
    request: Request,
    image: UploadFile = File(...),
    analysis_mode: Literal[
        "disease_diagnosis", "crop_identification", "field_health_analysis"
    ] = Form("disease_diagnosis"),
    farm_id: UUID | None = Form(default=None),
    user: CurrentUser = Depends(current_user),
    gateway: SupabaseGateway = Depends(get_gateway),
):
    content = await read_limited(image)
    validate_image(content, image.content_type)
    if farm_id:
        farms = await gateway.table(
            "farms",
            token=user.access_token,
            params={
                "select": "id",
                "id": f"eq.{farm_id}",
                "owner_id": f"eq.{user.id}",
                "limit": "1",
            },
        )
        if not farms:
            raise HTTPException(status_code=404, detail="Farm not found")
    # STAGING: image lands in UPLOAD_STAGING_DIR for inspection, then is
    # auto-deleted once analysis completes (finally). Stale crash leftovers
    # older than TTL are swept on each request. Nothing is kept in Supabase.
    staged: Path | None = None
    staging = _staging_dir()
    if staging is not None:
        _sweep_stale_staged(staging)
        suffix = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
        }.get(image.content_type or "", ".img")
        staged = _stage_upload(staging, content, suffix)
    try:
        result = await analyze_image(request.app.state.http, content, image.content_type, analysis_mode)
        # EPHEMERAL IMAGES: analyze in-memory, never upload to Supabase storage,
        # never persist image bytes. The diagnoses row is kept with the sentinel
        # image_path 'ephemeral' (column is NOT NULL) until the team decides the
        # final save policy. Marketplace listing uploads are unaffected.
        image_path = "ephemeral"
        analysis = extract_analysis(result)
        # LLM orchestration: fuse into one compact dense insight. Failure falls
        # back to stage outputs directly — never 500.
        insight = await fuse_insight(request.app.state.http, analysis)
        if insight:
            analysis["insight"] = insight
        record = {
            "owner_id": str(user.id),
            "farm_id": str(farm_id) if farm_id else None,
            "analysis_mode": analysis_mode,
            "image_path": image_path,
            "crop": analysis.get("crop"),
            "condition": analysis.get("condition"),
            "confidence": analysis.get("confidence"),
            "severity": database_severity(analysis),
            "result": analysis,
            "source": "web",
        }
        try:
            saved = await gateway.table(
                "diagnoses",
                method="POST",
                token=user.access_token,
                payload=record,
                prefer="return=representation",
            )
        except HTTPException:
            raise
        return saved[0] if isinstance(saved, list) and saved else record
    finally:
        _unstage(staged)


@router.post("/field-map")
async def field_map(
    request: Request,
    image: UploadFile = File(...),
    user: CurrentUser = Depends(current_user),
):
    """Vigor heatmap + 3D surface. Ephemeral: staged, forwarded, auto-deleted."""
    content = await read_limited(image)
    validate_image(content, image.content_type)
    staged: Path | None = None
    staging = _staging_dir()
    if staging is not None:
        _sweep_stale_staged(staging)
        suffix = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
        }.get(image.content_type or "", ".img")
        staged = _stage_upload(staging, content, suffix)
    try:
        return await field_vigor_map(request.app.state.http, content, image.content_type or "")
    finally:
        _unstage(staged)


@router.get("/diagnoses")
async def diagnosis_history(
    limit: int = 50,
    user: CurrentUser = Depends(current_user),
    gateway: SupabaseGateway = Depends(get_gateway),
):
    return await gateway.table(
        "diagnoses",
        token=user.access_token,
        params={
            "select": "*",
            "owner_id": f"eq.{user.id}",
            "order": "created_at.desc",
            "limit": str(min(max(limit, 1), 100)),
        },
    )


_FALLBACK_COLORS = ("grow", "consider", "rest")


@router.post("/field-plan")
async def field_plan(
    body: FieldPlanRequest,
    request: Request,
    user: CurrentUser = Depends(current_user),
    gateway: SupabaseGateway = Depends(get_gateway),
):
    regions_payload = [{"label": r.label, "confidence": r.confidence} for r in body.regions]
    planned = await plan_field_crops(
        request.app.state.http,
        regions_payload,
        body.land_size,
        body.state,
        body.district,
        body.season,
        body.goal,
    )
    if planned is None:
        zones = [
            FieldPlanZone(
                region_label=r.label[:200],
                crop="observe",
                color=_FALLBACK_COLORS[i % 3],  # type: ignore[arg-type]
                reason="LLM enrichment pending — showing detected zone without a crop recommendation.",
                price_source="unavailable" if body.goal == "money" else None,
            )
            for i, r in enumerate(body.regions)
        ]
        return FieldPlanResponse(
            zones=zones,
            summary=(
                "Detected zones mapped without LLM enrichment. "
                "LLM enrichment pending — review with a local agronomist before sowing."
            ),
            enriched=False,
        )
    zones = [FieldPlanZone.model_validate(z) for z in planned["zones"]]
    snapshot = []
    if body.goal == "money":
        snapshot = await _lookup_market_snapshot(
            gateway, user.access_token, zones, body.state
        )
    return FieldPlanResponse(
        zones=zones,
        summary=planned["summary"],
        enriched=True,
        market_snapshot=snapshot,
    )


async def _lookup_market_snapshot(
    gateway: SupabaseGateway,
    token: str,
    zones: list[FieldPlanZone],
    state: str | None,
) -> list:
    """Enrich money-goal zones with live per-quintal midpoints.

    Queries commodity_prices per distinct crop (latest 3 rows, optional
    state filter), averages min/max, and stamps each matching zone with the
    midpoint as estimated_revenue_inr_per_acre (per-quintal range only —
    never multiplied by yield). ANY DB failure returns [] and leaves zones
    with price_source "unavailable". Never raises.
    """
    from ..schemas import MarketSnapshotEntry

    crops: list[str] = []
    for zone in zones:
        crop = (zone.crop or "").strip()
        if not crop or crop.lower() == "observe":
            continue
        if crop.lower() not in {c.lower() for c in crops}:
            crops.append(crop[:80])
    entries: list[MarketSnapshotEntry] = []
    midpoints: dict[str, float] = {}
    try:
        for crop in crops:
            params = {
                "select": "min_price,max_price,date",
                "commodity": f"ilike.*{crop}*",
                "order": "date.desc",
                "limit": "3",
            }
            if state:
                params["state"] = f"eq.{state}"
            rows = await gateway.table(
                "commodity_prices", token=token, params=params
            )
            if not rows:
                continue
            try:
                mins = [float(r["min_price"]) for r in rows if r.get("min_price") is not None]
                maxs = [float(r["max_price"]) for r in rows if r.get("max_price") is not None]
            except (TypeError, ValueError, KeyError):
                continue
            if not mins or not maxs:
                continue
            avg_min = sum(mins) / len(mins)
            avg_max = sum(maxs) / len(maxs)
            dates = sorted(
                (str(r.get("date") or "") for r in rows if r.get("date")), reverse=True
            )
            entries.append(
                MarketSnapshotEntry(
                    crop=crop[:80],
                    avg_min_price=avg_min,
                    avg_max_price=avg_max,
                    unit="Rs/quintal",
                    as_of=(dates[0] if dates else "unknown")[:20],
                )
            )
            midpoints[crop.lower()] = (avg_min + avg_max) / 2
    except Exception as exc:
        logger.warning("Market price lookup failed, returning empty snapshot: %s", exc)
        for zone in zones:
            zone.estimated_revenue_inr_per_acre = None
            zone.price_source = "unavailable"
        return []
    for zone in zones:
        midpoint = midpoints.get((zone.crop or "").strip().lower())
        if midpoint is not None:
            zone.estimated_revenue_inr_per_acre = midpoint
            zone.price_source = "commodity_prices"
        else:
            zone.estimated_revenue_inr_per_acre = None
            zone.price_source = "unavailable"
    return entries
