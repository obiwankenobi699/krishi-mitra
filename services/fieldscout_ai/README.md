# FieldScout AI — two-stage crop vision (port 8003)

## Vigor maps + 3D canopy (tuning knobs)

`POST /field-map` returns `{vigor_map, surface_3d, grid, stats}` where
`grid` is the 128x128 percentile-stretched vigor array the interactive
3D client renders (same values as the heatmap/stats — bit-for-bit).

- Grid size: `SURFACE_GRID` + the `// 128` downsample in `vigor_service.py`
  (larger = finer terrain, bigger JSON).
- Blur radius: `gaussian_filter(..., sigma=2.0)` in `compute_vigor_map`
  (higher = smoother hills, fewer spikes).
- Colors: `_rdylgn()` (Python) and `vigorColor()` (`src/lib/canopy.ts`)
  must stay identical — red rgb(200,40,30) / yellow rgb(240,210,60) /
  green rgb(45,140,60). Change both together.
- 3D height: `HEIGHT_NORM` (`Canopy3D.tsx`) + the in-app slider (0.3–2.5×).
- Isolines: `uIso` density (`fract(vElev * 9.0)`) and strength in
  `enhanceMaterial`; scan sweep duration 1.4s; auto-rotate resume 4s.

On-device crop image diagnosis. FastAPI service that analyzes a leaf/field
photo and returns a bounded, machine-readable `VisionAnalysis` JSON object.

## Pipeline (two stages)

1. **Stage 1b — local YOLOv11x detector, PRIMARY (ONNX Runtime, GPU-first).**
   `_local_detect()` in `app/services/vision_service.py` delegates to
   `app/services/yolo_detector.py`: a lazy singleton loading
   `$MODEL_DIR/yolo11-plant/plantvillage_yolo11x.onnx` (+ `labels.json`,
   116 classes). JK-TK/PlantDiseaseDetection (MIT), trained on 23,689
   lab + field images — returns real bounding boxes, so the SVG overlay
   needs no heatmap estimation. CUDA provider first, CPU fallback with a
   warning. When no weights are staged, detection returns `None`.
2. **Stage 1a — local TensorFlow ResNet50 PlantVillage classifier (fallback
   seam, currently inactive).** `_local_classify()` delegates to
   `app/services/resnet_classifier.py` (`$MODEL_DIR/plantvillage_resnet50.keras`
   or `.h5`, 38 classes, Grad-CAM mask). No weights staged; kept as a
   documented fallback path.
3. **Stage 2 — Ollama VLM description + region proposals (OPTIONAL fallback).**
   The VLM runs only when `VISION_MODEL` is actually loaded in Ollama
   (cheap `/api/tags` probe, 3s timeout). With detections present and no
   VLM, the detector-first result (real boxes + template observations/actions
   marked for LLM enrichment) is returned directly — never a 500. If the
   VLM call fails mid-flight but stage-1 succeeded, the same fallback applies.

### Stage-1 weights: YOLOv11x active, ResNet drop-in preserved

Active: `$MODEL_DIR/yolo11-plant/plantvillage_yolo11x.onnx` (+ `labels.json`,
116 classes, MIT) — already staged. Re-export: `ultralytics` is a
conversion-only tool (never a runtime dep); see git history or rerun
`YOLO(...).export(format='onnx', imgsz=640)` then save `model.names`
as `labels.json`.

ResNet fallback (inactive, no weights staged): with your Kaggle ResNet-99.2 file:

| Your file | Action |
| --------- | ------ |
| `.keras` / `.h5` full 38-way model | copy to `$MODEL_DIR/plantvillage_resnet50.keras` (or `.h5`) |
| `.h5` weights-only (ResNet50 + Dense(38, softmax)) | copy to `$MODEL_DIR/plantvillage_resnet50.h5` |
| `.pth` (torch) | export to ONNX first, convert to Keras offline (`onnx2keras`), then drop in the `.keras` |
| `.onnx` direct | convert to Keras offline first — TF cannot load ONNX |

The checkpoint must pair with standard `resnet50.preprocess_input`
(caffe mode) on 224x224 RGB. After copying, restart fieldscout_ai and
validate: `PYTHONPATH=<repo-root>/services <venv>/bin/python -c "from
services.fieldscout_ai.app.services.resnet_classifier import
get_classifier; print(get_classifier())"`. `download_model.py` reports
weights status (`MODEL_DIR=/models python download_model.py`).
Env-gated fetch for operator-vetted URLs only:
`FIELDSCOUT_AUTO_DOWNLOAD=1` + `FIELDSCOUT_MODEL_URL=<https url>`
(default OFF).
   The image is sent (base64 data URL) to `ollama/<VISION_MODEL>` via
   `litellm.acompletion`, prompting for exactly one JSON object (no Markdown
   fences). The raw VLM JSON is coerced by `VisionService._parse_response`:
   regions are clamped to normalized 0–1 boxes (degenerate zero-area boxes
   dropped, at least one fallback box guaranteed), unknown severity strings
   map to `unknown`, and a missing `severity_score` is derived from the
   severity enum.

`download_model.py` (service root) reports stage-1 weights status in
`$MODEL_DIR` (no torch, no auto-fetch). It requires no ML deps.

## API

All routes require the internal API key (`shared.core.security` —
`X-Internal-API-Key` header). The gateway (`platform_api`) calls this service
and fuses the raw result with an LLM into the `insight` field.

### `POST /diagnose` → `VisionAnalysis`

Request (`multipart/form-data`):

| Field           | Type   | Values / notes                                              |
| --------------- | ------ | ----------------------------------------------------------- |
| `image`         | file   | JPEG/PNG/WebP, ≤ 10 MB, ≤ 40 MP, content must match MIME    |
| `analysis_mode` | form   | `disease_diagnosis` (default), `crop_identification`, `field_health_analysis` |

Response schema (`app/models.py`):

| Field                | Type                  | Notes                                              |
| -------------------- | --------------------- | -------------------------------------------------- |
| `analysis_mode`      | enum                  | echo of request mode                               |
| `crop`               | string \| null        | null when not reliably identifiable                |
| `condition`          | string                | diagnosis label                                    |
| `confidence`         | 0–1                   | VLM self-reported confidence                       |
| `severity`           | enum                  | `none`/`low`/`medium`/`high`/`unknown`             |
| `severity_score`     | 0–1                   | from VLM, else derived (none 0.0, low 0.25, medium 0.55, high 0.85) |
| `observations`       | string[] (≤ 10)       | VLM asked for max 3                                |
| `recommended_actions`| string[] (≤ 10)       | low-risk; advise expert review when uncertain      |
| `regions`            | RegionOfInterest[] (≤ 20) | normalized `x,y,width,height` 0–1 + `label` + `confidence`; always ≥ 1 box (fallback covers 0.1,0.1–0.9,0.9) for the frontend SVG overlay |
| `needs_expert_review`| bool                  | defaults true                                      |
| `summary`            | string (1–2000)       | max 2 sentences                                    |
| `insight`            | string \| null        | gateway-orchestrated dense fusion of stage-1 label + stage-2 description; null when served raw |
| `stage1_model`       | string                | which stage-1 produced the label (`"plantvillage-resnet50-tf"` or `"vlm-regions"`) |

VLM-absent behavior: with stage-1 weights staged but no VLM in Ollama,
`/diagnose` returns HTTP 200 with the classifier-first result
(`stage1_model: "plantvillage-resnet50-tf"`, template observations/actions
marked for LLM enrichment). With neither weights nor VLM: `503`.

Errors: `413` oversized upload / dimensions, `415` unsupported media type,
`422` invalid image or content/MIME mismatch, `502` VLM returned invalid
structured JSON, `503` VLM unreachable.

### Health

`GET /` and `GET /health` → `{"status": "ok", "service": "FieldScout AI"}`.

## Env

| Var                  | Example                    | Notes                                          |
| -------------------- | -------------------------- | ---------------------------------------------- |
| `VISION_MODEL`       | `qwen2.5vl:3b`             | single-model stack; never hardcoded in code    |
| `OLLAMA_API_BASE_URL`| `http://ollama:11434` (docker) / `http://localhost:11434` (native) | passed as litellm `api_base` |
| `INTERNAL_API_KEY`   | —                          | required by auth dependency                    |

Shared settings live in `services/shared/core/config.py` (read-only here).
`llava` (4.7 GB) OOMs a 4 GB GPU under `MAX_LOADED_MODELS=1`; use
`qwen2.5vl:3b` or `moondream`.

## Run (native, port 8003)

```bash
cd services/fieldscout_ai
PYTHONPATH=<repo-root>/services <venv>/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8003
```

`<venv>` is the consolidating root `.venv` (`uv sync` from repo root).
Docker: `fieldscout_ai` service, container port 8000 mapped to host
`127.0.0.1:8003`. Do not restart a live `:8003` process — the parent session
owns it.

## Layout

```text
app/main.py                 FastAPI app + CORS + router mount
app/api.py                  POST /diagnose (auth-guarded router)
app/models.py               AnalysisMode / Severity / RegionOfInterest / VisionAnalysis
app/services/vision_service.py  two-stage pipeline (TF-ResNet50 stage-1, optional VLM stage-2), parsing, validation
app/services/resnet_classifier.py GPU-only ResNet50 loader + Grad-CAM, 38 PlantVillage classes
download_model.py           stage-1 weights status helper (no torch; drop-in convention)
tests/test_models.py        contract + upload-limit unit tests
```

No `__init__.py` files — imports work as namespace packages (validated with
`import app.main` under `PYTHONPATH=<root>/services`).
