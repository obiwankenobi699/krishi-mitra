import json
import logging
import os
from typing import Any

import httpx
from fastapi import HTTPException

from ..config import settings
from .uploads import ALLOWED_IMAGE_TYPES

logger = logging.getLogger(__name__)

# LLM orchestration: fuse stage-1 label + stage-2 VLM description into one
# compact dense insight. Env-overridable; never hardcoded.
OLLAMA_BASE_URL = os.environ.get("OLLAMA_API_BASE_URL", "http://localhost:11434").rstrip("/")
FUSION_MODEL = os.environ.get("LOCAL_LLM_MODEL", "qwen2.5vl:3b")
FUSION_TIMEOUT_SECONDS = float(os.environ.get("FUSION_TIMEOUT_SECONDS", "30"))


DATABASE_SEVERITIES = {"unknown", "low", "medium", "high", "critical"}


def extract_analysis(result: dict) -> dict:
    analysis = result.get("analysis", result)
    if isinstance(analysis, str):
        try:
            analysis = json.loads(analysis)
        except json.JSONDecodeError:
            analysis = {"summary": analysis}
    if not isinstance(analysis, dict):
        raise HTTPException(status_code=502, detail="Crop analysis service returned invalid data")
    return analysis


def database_severity(analysis: dict) -> str:
    severity = analysis.get("severity", "unknown")
    return severity if severity in DATABASE_SEVERITIES else "unknown"


async def request_json(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    unavailable_message: str,
    **kwargs: Any,
) -> dict:
    try:
        response = await client.request(
            method,
            url,
            headers={"X-Internal-API-Key": settings.internal_api_key},
            timeout=settings.upstream_timeout_seconds,
            **kwargs,
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as exc:
        # Preserve upstream outage semantics (e.g. 503 when models/DB are
        # absent) instead of flattening everything to 502. The detail stays
        # generic so internal tracebacks never leak to clients.
        status_code = exc.response.status_code
        if status_code not in (502, 503, 504):
            status_code = 502
        raise HTTPException(status_code=status_code, detail=unavailable_message) from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=unavailable_message) from exc


async def analyze_image(
    client: httpx.AsyncClient, content: bytes, content_type: str, analysis_mode: str
) -> dict:
    return await request_json(
        client,
        "POST",
        f"{settings.fieldscout_url}/diagnose",
        unavailable_message="Crop analysis service is unavailable",
        files={"image": (f"upload{ALLOWED_IMAGE_TYPES[content_type]}", content, content_type)},
        data={"analysis_mode": analysis_mode},
    )


async def field_vigor_map(client: httpx.AsyncClient, content: bytes, content_type: str) -> dict:
    return await request_json(
        client,
        "POST",
        f"{settings.fieldscout_url}/field-map",
        unavailable_message="Vigor mapping is temporarily unavailable",
        files={"image": (f"upload{ALLOWED_IMAGE_TYPES[content_type]}", content, content_type)},
    )


async def fuse_insight(client: httpx.AsyncClient, analysis: dict) -> str | None:
    """Fuse classifier label + VLM description into one compact dense insight.

    Uses the small gateway LLM (qwen2.5vl:3b via Ollama). Short timeout;
    ANY failure returns None — the caller must fall back to stage outputs
    directly and never raise (never 500 on fusion failure).
    """
    try:
        prompt = (
            "You are an agronomist assistant. Given this crop diagnosis JSON, "
            "write one compact dense insight: condition + severity score 0-1, "
            "exactly 3 short observations, exactly 3 short actions. "
            "Keep it under 120 words, plain sentences, no markdown headers.\n"
            f"Diagnosis: {json.dumps(analysis)[:3000]}"
        )
        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={"model": FUSION_MODEL, "prompt": prompt, "stream": False},
            timeout=FUSION_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        text = response.json().get("response", "").strip()
        return text or None
    except Exception as exc:
        logger.warning("Insight fusion failed, using stage outputs directly: %s", exc)
        return None


FIELD_PLAN_FALLBACK_COLORS = ("grow", "consider", "rest")


async def plan_field_crops(
    client: httpx.AsyncClient,
    regions: list[dict],
    land_size: float | None,
    state: str | None,
    district: str | None,
    season: str = "kharif",
    goal: str = "yield",
    market_lines: str | None = None,
) -> dict | None:
    """Map each detected field zone to one crop via the gateway LLM.

    Returns {"zones": [...], "summary": str} or None on ANY failure —
    the caller must fall back to unenriched defaults and never raise.
    """
    try:
        zone_list = "; ".join(
            f"{str(r.get('label', 'zone'))[:80]} ({round(float(r.get('confidence', 0.5)) * 100)}%)"
            for r in regions[:20]
        )
        context = ""
        if land_size:
            context += f" Land size: {land_size} acres."
        if state:
            context += f" State: {state}."
        if district:
            context += f" District: {district}."
        season = (season or "kharif").strip().lower()[:20]
        if goal == "money":
            goal_line = (
                "Goal: maximize net rupees per acre using the provided market "
                "prices; prefer high price x yield."
            )
        else:
            goal_line = "Goal: maximize biomass/nutrition per acre."
            goal = "yield"
        if market_lines:
            market_section = f"MARKET (recent Rs/quintal ranges): {market_lines[:1500]}"
        else:
            market_section = (
                "MARKET: no live prices — use general knowledge and say so in one line."
            )
        prompt = (
            "You are an agronomist planning crops per field zone. "
            "Given these detected field zones, propose ONE crop per zone "
            "with color class (grow|consider|rest), one-line reason each, "
            "plus 2-sentence summary. "
            f"Season: {season}. {goal_line} {market_section} "
            "Respond with STRICT JSON only, no markdown: "
            '{"zones": [{"region_label": string, "crop": string, '
            '"color": "grow|consider|rest", "reason": string, '
            '"estimated_revenue_inr_per_acre": number|null}], '
            '"summary": string}. '
            f"Zones: {zone_list}.{context}"
        )
        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={"model": FUSION_MODEL, "prompt": prompt, "stream": False, "format": "json"},
            timeout=FUSION_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        text = (response.json().get("response") or "").strip()
        if not text:
            return None
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            start, end = text.find("{"), text.rfind("}")
            if start < 0 or end <= start:
                return None
            try:
                payload = json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return None
        if isinstance(payload, list):
            payload = next((i for i in payload if isinstance(i, dict)), None)
        if not isinstance(payload, dict):
            return None
        raw_zones = payload.get("zones")
        if not isinstance(raw_zones, list) or not raw_zones:
            return None
        zones: list[dict] = []
        for i, item in enumerate(raw_zones[: len(regions)]):
            if not isinstance(item, dict):
                continue
            fallback_label = (
                str(regions[i].get("label", f"zone-{i + 1}")) if i < len(regions) else f"zone-{i + 1}"
            )
            color = str(item.get("color") or "").strip().lower()
            if color not in FIELD_PLAN_FALLBACK_COLORS:
                color = FIELD_PLAN_FALLBACK_COLORS[i % 3]
            revenue = item.get("estimated_revenue_inr_per_acre")
            try:
                revenue = float(revenue) if revenue is not None else None
            except (TypeError, ValueError):
                revenue = None
            if revenue is not None and revenue < 0:
                revenue = None
            zones.append(
                {
                    "region_label": str(item.get("region_label") or fallback_label)[:200],
                    "crop": str(item.get("crop") or "observe")[:80],
                    "color": color,
                    "reason": str(item.get("reason") or "LLM enrichment pending.")[:300],
                    "estimated_revenue_inr_per_acre": revenue,
                    "price_source": None,
                }
            )
        for i in range(len(zones), len(regions)):
            zones.append(
                {
                    "region_label": str(regions[i].get("label", f"zone-{i + 1}"))[:200],
                    "crop": "observe",
                    "color": FIELD_PLAN_FALLBACK_COLORS[i % 3],
                    "reason": "LLM enrichment pending.",
                }
            )
        summary = str(payload.get("summary") or "").strip()[:1000]
        if not summary:
            summary = (
                f"Proposed crops for {len(zones)} detected zones. "
                "LLM enrichment pending review."
            )
        return {"zones": zones, "summary": summary}
    except Exception as exc:
        logger.warning("Field-plan LLM failed, using unenriched defaults: %s", exc)
        return None
