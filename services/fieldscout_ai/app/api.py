import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from shared.core.security import require_internal_api_key

from .models import AnalysisMode, VisionAnalysis, VigorMapResponse
from .services.vigor_service import compute_vigor_map
from .services.vision_service import vision_service

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_internal_api_key)])


@router.post("/diagnose", response_model=VisionAnalysis, tags=["Vision"])
async def diagnose_crop_image(
    image: UploadFile = File(...),
    analysis_mode: AnalysisMode = Form(AnalysisMode.disease_diagnosis),
) -> VisionAnalysis:
    """Analyze a validated agricultural image with the local vision model."""
    result = await vision_service.analyze_image(image, analysis_mode)
    return result


@router.post("/field-map", response_model=VigorMapResponse, tags=["Vision"])
async def field_vigor_map(image: UploadFile = File(...)) -> VigorMapResponse:
    """VARI vigor overlay + 3D canopy surface, computed locally (no models)."""
    import asyncio

    from shared.core.uploads import read_limited_upload

    from .services.vision_service import (
        ALLOWED_IMAGE_TYPES,
        MAX_IMAGE_BYTES,
        vision_service,
    )

    image_bytes = await read_limited_upload(
        image,
        max_bytes=MAX_IMAGE_BYTES,
        allowed_content_types=ALLOWED_IMAGE_TYPES,
    )
    vision_service._validate_image(image_bytes, image.content_type or "")
    try:
        result = await asyncio.to_thread(compute_vigor_map, image_bytes)
    except Exception as exc:
        logger.exception("Vigor map failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Vigor mapping is temporarily unavailable",
        ) from exc
    return VigorMapResponse(**result)
