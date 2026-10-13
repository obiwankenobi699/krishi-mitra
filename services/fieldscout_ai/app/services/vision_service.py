import base64
import io
import json
import logging

from fastapi import HTTPException, UploadFile, status
from PIL import Image, UnidentifiedImageError
from pydantic import ValidationError

from shared.core.config import settings
from shared.core.uploads import read_limited_upload

from ..models import AnalysisMode, RegionOfInterest, Severity, VisionAnalysis

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
EXPECTED_IMAGE_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}

# ---------------------------------------------------------------------------
# Stage-1 fast-model seam
# ---------------------------------------------------------------------------
# Preferred: a small local PlantVillage classifier (ONNX Runtime or
# ultralytics) that returns a label + confidence in milliseconds without
# touching the GPU-heavy VLM. Neither onnxruntime nor ultralytics is in
# requirements.lock, and torch is absent (transformers alone cannot run
# BeitForImageClassification), so stage-1 currently falls through to
# "vlm-regions": the VLM itself proposes the label AND the region boxes.
#
# To slot the fast model in later (no API change):
#   1. Add the dep to requirements.txt + regenerate requirements.lock.
#   2. Implement _local_classify() below to return (label, confidence).
#   3. Pass that label into the stage-2 prompt as a prior.
# The response contract (regions[], stage1_model, severity_score) already
# holds, so gateway + frontend need no changes.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Stage-1 fast-model: local TensorFlow ResNet50 PlantVillage classifier
# (GPU-only, torch-free). See app/services/resnet_classifier.py.
# ---------------------------------------------------------------------------
# _local_classify() returns (label, confidence, gradcam_mask_b64|None) or
# None when no weights are staged in $MODEL_DIR. Stage 2 (Ollama VLM) is
# an OPTIONAL fallback: it runs only when VISION_MODEL is actually loaded
# in Ollama (cheap /api/tags probe, 3s timeout). Otherwise the
# classifier-first result below is returned directly — never a 500.
#
# Response contract is unchanged either way: regions[] holds normalized
# 0-1 boxes (classifier path derives the box from the Grad-CAM hot area),
# plus severity/severity_score/observations/actions/summary.
# ---------------------------------------------------------------------------
STAGE1_MODEL_NAME = "vlm-regions"
STAGE1_MODEL_NAME_TF = "plantvillage-resnet50-tf"

SEVERITY_TO_SCORE = {
    Severity.none: 0.0,
    Severity.low: 0.25,
    Severity.medium: 0.55,
    Severity.high: 0.85,
    Severity.unknown: 0.0,
}


def _local_classify(image_bytes: bytes) -> tuple[str, float, str | None] | None:
    """Fast local first stage. Returns (label, confidence, mask_b64|None).

    None when no ResNet50 weights are staged in $MODEL_DIR (see
    resnet_classifier.py + README.md). The TF import stays lazy inside
    get_classifier() so module import is cheap and TF-free when idle.
    This function never raises — classifier errors degrade to None and
    the caller picks the VLM or classifier-first path accordingly.
    """
    try:
        from .resnet_classifier import get_classifier
    except ImportError:
        logger.debug("stage-1: resnet_classifier unavailable")
        return None
    try:
        classifier = get_classifier()
    except RuntimeError:
        # GPU-only gate tripped (no CUDA device) or unloadable weights.
        logger.warning("stage-1: classifier unavailable", exc_info=True)
        return None
    if classifier is None:
        return None
    try:
        return classifier.classify(image_bytes)
    except Exception:
        logger.warning("stage-1: classification failed", exc_info=True)
        return None


def _local_detect(image_bytes: bytes) -> list[dict] | None:
    """Fast local YOLO stage. Returns detection dicts or None.

    Dicts: {label, confidence, x, y, width, height} (normalized 0-1).
    None when weights absent or inference fails — caller falls back.
    Never raises.
    """
    try:
        from .yolo_detector import get_detector
    except ImportError:
        logger.debug("stage-1: yolo_detector unavailable")
        return None
    try:
        detector = get_detector()
    except Exception:
        logger.warning("stage-1: detector unavailable", exc_info=True)
        return None
    if detector is None:
        return None
    try:
        return detector.detect(image_bytes)
    except Exception:
        logger.warning("stage-1: detection failed", exc_info=True)
        return None


class VisionService:
    def __init__(self):
        self.prompts = {
            AnalysisMode.disease_diagnosis: """
                Analyze the plant image for visible disease, pest, or nutrient-stress signs.
                Do not claim certainty when the visual evidence is ambiguous.
            """,
            AnalysisMode.crop_identification: """
                Identify the crop using visible characteristics. If it cannot be identified
                reliably, set crop to null and explain what additional image is needed.
            """,
            AnalysisMode.field_health_analysis: """
                Review this wide field image for visible discoloration, patchiness, growth
                variation, irrigation patterns, and areas needing closer inspection.
            """,
        }

    @staticmethod
    def _validate_image(image_bytes: bytes, content_type: str) -> None:
        try:
            with Image.open(io.BytesIO(image_bytes)) as image:
                if image.format != EXPECTED_IMAGE_FORMATS[content_type]:
                    raise HTTPException(
                        status_code=422,
                        detail="Image content does not match its declared media type",
                    )
                image.verify()
                if image.width * image.height > 40_000_000:
                    raise HTTPException(status_code=413, detail="Image dimensions are too large")
        except HTTPException:
            raise
        except (UnidentifiedImageError, OSError) as exc:
            raise HTTPException(status_code=422, detail="Upload is not a valid image") from exc

    @staticmethod
    def _clamp01(value: object) -> float:
        try:
            return min(1.0, max(0.0, float(value)))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return 0.0

    @classmethod
    def _parse_regions(cls, raw: object, fallback_label: str) -> list[RegionOfInterest]:
        """Coerce VLM region proposals to normalized boxes; never raises."""
        if isinstance(raw, (list, tuple)) and raw and all(
            isinstance(v, (int, float)) for v in raw
        ):
            # Flat coordinate array [x, y, w, h, (confidence?)] used as the
            # whole regions value by some small VLMs.
            raw = [list(raw)]
        if not isinstance(raw, list):
            return []
        regions: list[RegionOfInterest] = []
        for item in raw[:20]:
            if isinstance(item, (list, tuple)) and len(item) >= 4:
                # Bare coordinate array [x, y, w, h, (confidence?)].
                try:
                    numbers = [cls._clamp01(v) for v in item[:5]]
                except (TypeError, ValueError):
                    continue
                try:
                    regions.append(
                        RegionOfInterest.model_validate(
                            {
                                "x": numbers[0],
                                "y": numbers[1],
                                "width": numbers[2],
                                "height": numbers[3],
                                "label": fallback_label[:200],
                                "confidence": numbers[4] if len(numbers) > 4 else 0.5,
                            }
                        )
                    )
                except (ValidationError, ValueError, TypeError):
                    continue
                continue
            if not isinstance(item, dict):
                continue
            try:
                regions.append(
                    RegionOfInterest.model_validate(
                        {
                            "x": cls._clamp01(item.get("x", 0)),
                            "y": cls._clamp01(item.get("y", 0)),
                            "width": cls._clamp01(item.get("width", item.get("w", 0))),
                            "height": cls._clamp01(item.get("height", item.get("h", 0))),
                            "label": str(item.get("label", fallback_label) or fallback_label)[:200],
                            "confidence": cls._clamp01(item.get("confidence", 0.5)),
                        }
                    )
                )
            except (ValidationError, ValueError, TypeError):
                continue
        # Drop degenerate zero-area boxes.
        return [r for r in regions if r.width > 0 and r.height > 0]

    @staticmethod
    def _extract_payload(raw_response: str) -> dict:
        """Recover the first JSON object from small-VLM output.

        Small VLMs (e.g. moondream) wrap output in prose or return an
        array of partial objects. Find the first '{'/'[' and decode from
        there; arrays contribute their first object element.
        """
        cleaned = (raw_response or "").strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.removeprefix("```json").removeprefix("```")
            cleaned = cleaned.removesuffix("```").strip()
        start = min(
            (i for i in (cleaned.find("{"), cleaned.find("[")) if i >= 0),
            default=-1,
        )
        if start < 0:
            raise ValueError("VLM response contains no JSON")
        fragment = cleaned[start:]
        try:
            payload = json.JSONDecoder().raw_decode(fragment)[0]
        except json.JSONDecodeError:
            payload = None
        if payload is None:
            # Small VLMs ramble (`...` separators, repeated keys) or get cut
            # off at the token cap. Fall back to the first balanced {...}
            # object, which is usually complete.
            payload = VisionService._first_balanced_object(fragment)
        if isinstance(payload, list):
            payload = next((i for i in payload if isinstance(i, dict)), None)
        if not isinstance(payload, dict):
            raise ValueError("VLM response is not a JSON object")
        return payload

    @staticmethod
    def _first_balanced_object(fragment: str) -> dict | None:
        """Return the first balanced {...} object in fragment, if any."""
        start = fragment.find("{")
        if start < 0:
            return None
        depth = 0
        in_string = False
        escaped = False
        for i in range(start, len(fragment)):
            ch = fragment[i]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        candidate = json.loads(fragment[start : i + 1])
                    except json.JSONDecodeError:
                        return None
                    return candidate if isinstance(candidate, dict) else None
        # Unbalanced (cut off at the token cap): salvage complete
        # "key": value pairs from the prefix instead.
        return VisionService._salvage_pairs(fragment[start + 1 :])

    @staticmethod
    def _salvage_pairs(body: str) -> dict | None:
        """Collect complete top-level "key": value pairs until first gap."""
        decoder = json.JSONDecoder()
        result: dict = {}
        i, n = 0, len(body)
        while i < n:
            while i < n and body[i] in " \t\r\n,":
                i += 1
            if i >= n or body[i] != '"':
                break
            try:
                key, end = decoder.raw_decode(body[i:])
            except json.JSONDecodeError:
                break
            if not isinstance(key, str):
                break
            j = end + i
            while j < n and body[j] in " \t\r\n":
                j += 1
            if j >= n or body[j] != ":":
                break
            j += 1
            while j < n and body[j] in " \t\r\n":
                j += 1
            try:
                value, end2 = decoder.raw_decode(body[j:])
            except json.JSONDecodeError:
                break
            result[key] = value
            i = j + end2
        return result or None

    @classmethod
    def _parse_response(
        cls, raw_response: str, analysis_mode: AnalysisMode, stage1_label: str | None
    ) -> VisionAnalysis:
        try:
            payload = cls._extract_payload(raw_response)
            payload["analysis_mode"] = analysis_mode
            condition = str(payload.get("condition", "") or "").strip()
            # Stage-1 prior wins only when the VLM is vague.
            if stage1_label and (not condition or condition.lower() in {"unknown", "none"}):
                payload["condition"] = stage1_label
            if not str(payload.get("condition", "") or "").strip():
                payload["condition"] = "Unknown"
            if payload.get("confidence") is None:
                payload["confidence"] = 0.5
            if not str(payload.get("summary", "") or "").strip():
                # Derived fallback, never fabricated detail: point at the
                # condition label the model itself produced.
                payload["summary"] = f"{payload['condition']} (see observations)."
            condition = str(payload["condition"])
            # Small VLMs emit numbers/bools inside string arrays; keep text.
            for key in ("observations", "recommended_actions"):
                values = payload.get(key)
                if isinstance(values, list):
                    payload[key] = [str(v)[:500] for v in values if isinstance(v, str)][:10]
            regions = cls._parse_regions(payload.get("regions"), condition)
            if not regions:
                # Contract guarantee: always at least one box so the
                # frontend overlay has something to render.
                regions = [
                    RegionOfInterest(
                        x=0.1,
                        y=0.1,
                        width=0.8,
                        height=0.8,
                        label=condition[:200],
                        confidence=cls._clamp01(payload.get("confidence", 0.5)),
                    )
                ]
            payload["regions"] = [r.model_dump() for r in regions]
            # Small VLMs add stray keys ("label", ...); the schema forbids
            # extras, so keep only known fields.
            payload = {
                key: payload[key]
                for key in (
                    "analysis_mode", "crop", "condition", "confidence",
                    "severity", "severity_score", "observations",
                    "recommended_actions", "regions", "needs_expert_review",
                    "summary", "insight", "stage1_model",
                )
                if key in payload
            }
            severity_raw = str(payload.get("severity", "unknown")).lower()
            try:
                severity = Severity(severity_raw)
            except ValueError:
                severity = Severity.unknown
                payload["severity"] = "unknown"
            if payload.get("severity_score") is None:
                payload["severity_score"] = SEVERITY_TO_SCORE[severity]
            else:
                payload["severity_score"] = cls._clamp01(payload.get("severity_score"))
            payload.setdefault("stage1_model", STAGE1_MODEL_NAME)
            return VisionAnalysis.model_validate(payload)
        except (AttributeError, json.JSONDecodeError, TypeError, ValueError, ValidationError) as exc:
            logger.warning("Vision model returned an invalid structured response: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Vision model returned an invalid response",
            ) from exc

    @staticmethod
    def _vlm_available() -> bool:
        """Cheap Ollama probe: is VISION_MODEL currently loaded? 3s timeout."""
        try:
            import httpx

            response = httpx.get(f"{settings.OLLAMA_API_BASE_URL}/api/tags", timeout=3.0)
            if response.status_code != 200:
                return False
            want = settings.VISION_MODEL.split(":")[0]
            names = [str(m.get("name", "")) for m in response.json().get("models", [])]
            return any(n.split(":")[0] == want for n in names)
        except Exception:
            return False

    @classmethod
    def _classifier_first_result(
        cls, stage1: tuple[str, float, str | None], analysis_mode: AnalysisMode
    ) -> VisionAnalysis:
        """Classifier-only VisionAnalysis for when the VLM is unreachable.

        Template observations/actions are marked for LLM enrichment by the
        gateway; severity stays honest (unknown unless healthy).
        """
        from .resnet_classifier import mask_to_bbox

        label, confidence, mask_b64 = stage1
        parts = label.split("___")
        crop = parts[0].replace("_", " ").replace("(including sour)", "").strip() or None
        condition = parts[-1].replace("_", " ").strip() or label
        healthy = condition.lower() == "healthy"
        conf = cls._clamp01(confidence)

        bbox = mask_to_bbox(mask_b64)
        if bbox is None:
            bbox = (0.1, 0.1, 0.8, 0.8)
        regions = [
            RegionOfInterest(
                x=bbox[0], y=bbox[1], width=bbox[2], height=bbox[3],
                label=condition[:200], confidence=conf,
            )
        ]
        return VisionAnalysis(
            analysis_mode=analysis_mode,
            crop=crop,
            condition=condition,
            confidence=conf,
            severity=Severity.none if healthy else Severity.unknown,
            severity_score=0.0,
            observations=[
                f"Local ResNet50 classifier predicts {condition}"
                + (f" on {crop}" if crop else "")
                + f" with {round(conf * 100)}% confidence.",
                "Vision-language enrichment unavailable (VLM not reachable); "
                "this result is classifier-only and marked for LLM enrichment.",
            ],
            recommended_actions=[
                "Have a local agronomist confirm before spraying or fertilizing.",
                "Re-photograph the affected leaf in daylight if confidence is low.",
                "Isolate severely affected plants where practical.",
            ],
            regions=regions,
            needs_expert_review=not (healthy and conf >= 0.9),
            summary=f"Classifier-only diagnosis: {condition}"
            + (f" ({crop})" if crop else "")
            + f", confidence {round(conf * 100)}%. LLM enrichment pending.",
            stage1_model=STAGE1_MODEL_NAME_TF,
        )

    @classmethod
    def _detector_first_result(
        cls, detections: list[dict], analysis_mode: AnalysisMode
    ) -> VisionAnalysis:
        """Detector-only VisionAnalysis: real YOLO boxes, no VLM needed.

        Template observations/actions are marked for LLM enrichment by the
        gateway; severity stays honest (unknown unless healthy).
        """
        top = detections[0]
        condition = str(top.get("label") or "Unknown")
        conf = cls._clamp01(top.get("confidence", 0.0))
        healthy = "healthy" in condition.lower()
        regions = [
            RegionOfInterest(
                x=cls._clamp01(d.get("x", 0.1)),
                y=cls._clamp01(d.get("y", 0.1)),
                width=max(0.01, cls._clamp01(d.get("width", 0.8))),
                height=max(0.01, cls._clamp01(d.get("height", 0.8))),
                label=str(d.get("label", condition))[:200],
                confidence=cls._clamp01(d.get("confidence", conf)),
            )
            for d in detections
        ]
        return VisionAnalysis(
            analysis_mode=analysis_mode,
            crop=None,
            condition=condition,
            confidence=conf,
            severity=Severity.none if healthy else Severity.unknown,
            severity_score=0.0,
            observations=[
                f"Local YOLO detector found {condition} "
                f"with {round(conf * 100)}% confidence "
                f"({len(regions)} affected area{'s' if len(regions) != 1 else ''}).",
                "Vision-language enrichment unavailable (no VLM loaded); "
                "this result is detector-only and marked for LLM enrichment.",
            ],
            recommended_actions=[
                "Have a local agronomist confirm before spraying or fertilizing.",
                "Re-photograph the affected leaf in daylight if confidence is low.",
                "Isolate severely affected plants where practical.",
            ],
            regions=regions,
            needs_expert_review=not (healthy and conf >= 0.9),
            summary=f"Detector diagnosis: {condition}, confidence {round(conf * 100)}%. LLM enrichment pending.",
            stage1_model="plantvillage-yolo11x-onnx",
        )

    async def analyze_image(
        self, image_file: UploadFile, analysis_mode: AnalysisMode
    ) -> VisionAnalysis:
        from litellm import acompletion

        image_bytes = await read_limited_upload(
            image_file,
            max_bytes=MAX_IMAGE_BYTES,
            allowed_content_types=ALLOWED_IMAGE_TYPES,
        )
        self._validate_image(image_bytes, image_file.content_type or "")

        # Stage 1: fast local ResNet50 (GPU-only). None → no weights staged.
        stage1 = _local_classify(image_bytes)
        stage1_label = stage1[0] if stage1 else None

        # Stage 1b: YOLOv11x detector (116 lab+field classes, real boxes).
        # Preferred when staged — boxes beat heatmaps for the SVG overlay.
        detections = _local_detect(image_bytes)

        # Stage 2 is OPTIONAL: run the VLM only when it is actually
        # available in Ollama. Otherwise return the detector-first (or
        # classifier-first) result — never a 500.
        if not self._vlm_available():
            if detections:
                logger.info("stage-2: VLM %s not in Ollama; returning detector-first result",
                            settings.VISION_MODEL)
                return self._detector_first_result(detections, analysis_mode)
            if stage1:
                logger.info("stage-2: VLM %s not in Ollama; returning classifier-first result",
                            settings.VISION_MODEL)
                return self._classifier_first_result(stage1, analysis_mode)

        # Stage 2: Ollama VLM description + region proposals.
        # Model tag comes from settings (VISION_MODEL) — never hardcoded.
        # NOTE (.env): VISION_MODEL=llava (4.7GB) OOMs a 4GB RTX 3050 under
        # MAX_LOADED_MODELS=1; switch to qwen2.5vl:3b or moondream.
        base64_image = base64.b64encode(image_bytes).decode("utf-8")
        image_data_url = f"data:{image_file.content_type};base64,{base64_image}"
        prior_hint = (
            f"A fast local classifier suggests: {stage1_label}. "
            "Use it as a prior but trust clear visual evidence."
            if stage1_label
            else ""
        )
        if detections:
            boxes = "; ".join(
                f"{d.get('label')} ({round(float(d.get('confidence', 0)) * 100)}%)"
                for d in detections[:5]
            )
            prior_hint += (
                f" A local detector found these affected areas: {boxes}. "
                "Keep one region per affected area in your response."
            )
        prompt = f"""{self.prompts[analysis_mode]}
{prior_hint}
Return only one JSON object with exactly these fields (a single object, never an array):crop (string or null), condition (string), confidence (number from 0 to 1),
severity (one of none, low, medium, high, unknown), observations (string array,
max 3 items), recommended_actions (string array, max 3 items),
regions (array of objects with x, y, width, height as normalized 0-1 floats,
label string, confidence 0-1 — one box per visibly affected area; if the whole
frame is affected use one box x=0.1 y=0.1 width=0.8 height=0.8),
needs_expert_review (boolean), and summary (string, max 2 sentences).
Recommendations must be low-risk and advise expert review for uncertain or severe cases.
Do not include Markdown fences."""

        try:
            response = await acompletion(
                model=f"ollama/{settings.VISION_MODEL}",
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": image_data_url}},
                    ],
                }],
                api_base=settings.OLLAMA_API_BASE_URL,
                timeout=120,
                # Small VLMs need headroom but ramble when given too much;
                # ~400 output tokens fits the full schema; missing keys fall
                # back to safe defaults in _parse_response.
                max_tokens=512,
                # Constrained JSON decoding (Ollama "format": "json").
                # Small VLMs trail into "..." or echo placeholders without it.
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content or ""
            logger.debug("VLM raw response (first 500 chars): %r", content[:500])
            result = self._parse_response(content, analysis_mode, stage1_label)
            if stage1:
                result.stage1_model = STAGE1_MODEL_NAME_TF
            return result
        except HTTPException:
            raise
        except Exception as exc:
            if stage1:
                logger.warning("stage-2: VLM request failed; returning classifier-first result")
                return self._classifier_first_result(stage1, analysis_mode)
            logger.exception("Vision model request failed")
            if not stage1:
                # Neither local weights nor VLM available — say exactly why.
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=(
                        "Disease model weights are not installed — "
                        "place plantvillage_resnet50.keras (or .h5) in the "
                        "models directory, then retry."
                    ),
                ) from exc
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Vision analysis is temporarily unavailable",
            ) from exc


vision_service = VisionService()
