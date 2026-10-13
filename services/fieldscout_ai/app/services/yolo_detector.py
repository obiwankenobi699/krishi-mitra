"""Local YOLOv11x plant-disease detector (stage-1 fast path, ONNX Runtime).

Primary local model: JK-TK/PlantDiseaseDetection (MIT) — YOLOv11x trained on
23,689 lab + field images across 116 classes. Exported once to ONNX
(``plantvillage_yolo11x.onnx`` + ``labels.json``); the ultralytics/torch
toolchain is conversion-only and is NOT a runtime dependency.

Runtime needs only ``onnxruntime`` (+ ``-gpu`` build here): CUDA provider
first, CPU fallback with a loud warning. No Ollama, no torch at serve time.
Post-processing (letterbox, NMS) is numpy + stdlib only.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

MODEL_BASENAME = "plantvillage_yolo11x"
ONNX_NAME = f"{MODEL_BASENAME}.onnx"
LABELS_NAME = "labels.json"
INPUT_SIZE = 640
CONF_THRESHOLD = 0.25
IOU_THRESHOLD = 0.45
MAX_DETECTIONS = 20


def _model_dir() -> Path:
    from shared.core.config import settings

    return Path(settings.MODEL_DIR) / "yolo11-plant"


def find_weights_path(model_dir: Path | None = None) -> Path | None:
    """Return the staged .onnx path, or None when absent."""
    base = model_dir or _model_dir()
    candidate = base / ONNX_NAME
    return candidate if candidate.is_file() else None


def load_labels(model_dir: Path | None = None) -> dict[int, str]:
    """Class-id → name map saved next to the ONNX export."""
    base = model_dir or _model_dir()
    path = base / LABELS_NAME
    try:
        raw = json.loads(path.read_text())
        return {int(k): str(v) for k, v in raw.items()}
    except Exception as exc:
        logger.warning("stage-1: labels unreadable at %s: %s", path, exc)
        return {}


def _letterbox(image, size: int):
    """Resize + pad to square, returning (array_nchw, scale, pad_x, pad_y)."""
    import numpy as np
    from PIL import Image

    w, h = image.size
    scale = size / max(w, h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    resized = image.resize((nw, nh), Image.BILINEAR)
    canvas = Image.new("RGB", (size, size), (114, 114, 114))
    pad_x, pad_y = (size - nw) // 2, (size - nh) // 2
    canvas.paste(resized, (pad_x, pad_y))
    arr = np.asarray(canvas, dtype=np.float32) / 255.0
    return arr.transpose(2, 0, 1)[None], scale, pad_x, pad_y


def _nms(boxes, scores, iou_thr: float) -> list[int]:
    """Greedy NMS on xyxy boxes. Returns kept indices."""
    import numpy as np

    if len(boxes) == 0:
        return []
    boxes = np.asarray(boxes, dtype=np.float32)
    order = np.argsort(-np.asarray(scores, dtype=np.float32))
    kept: list[int] = []
    while len(order) > 0:
        i = int(order[0])
        kept.append(i)
        if len(order) == 1:
            break
        xx1 = np.maximum(boxes[i, 0], boxes[order[1:], 0])
        yy1 = np.maximum(boxes[i, 1], boxes[order[1:], 1])
        xx2 = np.minimum(boxes[i, 2], boxes[order[1:], 2])
        yy2 = np.minimum(boxes[i, 3], boxes[order[1:], 3])
        inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        area_i = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
        area_o = (boxes[order[1:], 2] - boxes[order[1:], 0]) * (
            boxes[order[1:], 3] - boxes[order[1:], 1]
        )
        iou = inter / (area_i + area_o - inter + 1e-9)
        order = order[1:][iou <= iou_thr]
    return kept


class YoloDetector:
    """Lazy ONNX YOLO detector. Construct via get_detector()."""

    def __init__(self, weights_path: Path) -> None:
        import onnxruntime as ort

        self.weights_path = weights_path
        self.labels = load_labels(weights_path.parent)
        options = ort.SessionOptions()
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # CPU by default: the 4GB card must keep ~2.5GB free for the Ollama LLM.
        # YOLOv11x runs ~0.3s on CPU — still fast. Opt into GPU with
        # YOLO_PROVIDERS=cuda,cpu when VRAM allows.
        want = [p.strip().upper() for p in os.environ.get("YOLO_PROVIDERS", "cpu").split(",")]
        order = []
        for w in want:
            if w in ("CUDA", "GPU"):
                order.append("CUDAExecutionProvider")
            elif w == "CPU":
                order.append("CPUExecutionProvider")
        providers = order or ["CPUExecutionProvider"]
        try:
            self.session = ort.InferenceSession(
                str(weights_path),
                sess_options=options,
                providers=providers,
            )
        except Exception:
            logger.warning("stage-1: %s unavailable, CPU fallback", providers, exc_info=True)
            self.session = ort.InferenceSession(
                str(weights_path),
                sess_options=options,
                providers=["CPUExecutionProvider"],
            )
        active = self.session.get_providers()
        logger.info("stage-1: YOLO session providers: %s (%d classes)", active, len(self.labels))
        self.input_name = self.session.get_inputs()[0].name
        self._lock = threading.Lock()
        self.last_latency_s: float | None = None

    def detect(self, image_bytes: bytes) -> list[dict]:
        """Return detections [{label, confidence, x, y, width, height}] normalized 0-1."""
        import numpy as np
        from PIL import Image
        import io as _io

        with Image.open(_io.BytesIO(image_bytes)) as img:
            w0, h0 = img.size
            rgb = img.convert("RGB")
            batch, scale, pad_x, pad_y = _letterbox(rgb, INPUT_SIZE)
        start = time.perf_counter()
        with self._lock:
            (output,) = self.session.run(None, {self.input_name: batch})
        self.last_latency_s = time.perf_counter() - start
        # (1, 4+nc, 8400) -> (8400, 4+nc): cx, cy, w, h, class scores
        preds = np.asarray(output[0]).transpose(1, 0) if output.shape[1] != output.shape[2] else np.asarray(output[0])
        if preds.shape[1] < 5:
            return []
        boxes_cxcywh = preds[:, :4]
        scores = preds[:, 4:]
        class_ids = scores.argmax(axis=1)
        confs = scores.max(axis=1)
        keep = confs >= CONF_THRESHOLD
        if not keep.any():
            return []
        boxes_cxcywh, class_ids, confs = boxes_cxcywh[keep], class_ids[keep], confs[keep]
        # cxcywh (padded 640 space) -> xyxy in ORIGINAL image pixels
        x1 = (boxes_cxcywh[:, 0] - boxes_cxcywh[:, 2] / 2 - pad_x) / scale
        y1 = (boxes_cxcywh[:, 1] - boxes_cxcywh[:, 3] / 2 - pad_y) / scale
        x2 = (boxes_cxcywh[:, 0] + boxes_cxcywh[:, 2] / 2 - pad_x) / scale
        y2 = (boxes_cxcywh[:, 1] + boxes_cxcywh[:, 3] / 2 - pad_y) / scale
        xyxy = np.stack([x1, y1, x2, y2], axis=1)
        kept = _nms(xyxy.tolist(), confs.tolist(), IOU_THRESHOLD)[:MAX_DETECTIONS]
        detections = []
        for i in kept:
            cid = int(class_ids[i])
            detections.append(
                {
                    "label": self.labels.get(cid, f"class_{cid}"),
                    "confidence": float(min(1.0, max(0.0, confs[i]))),
                    "x": float(min(1.0, max(0.0, x1[i] / w0))),
                    "y": float(min(1.0, max(0.0, y1[i] / h0))),
                    "width": float(min(1.0, max(0.01, (x2[i] - x1[i]) / w0))),
                    "height": float(min(1.0, max(0.01, (y2[i] - y1[i]) / h0))),
                }
            )
        logger.info(
            "stage-1: YOLO %d detections, top=%s (%.1f ms)",
            len(detections),
            detections[0]["label"] if detections else None,
            (self.last_latency_s or 0) * 1000,
        )
        return detections

    def classify(self, image_bytes: bytes) -> tuple[str, float, None]:
        """Compat with the classifier-first contract: (top_label, conf, no-mask)."""
        detections = self.detect(image_bytes)
        if not detections:
            return "unknown", 0.0, None
        top = detections[0]
        return top["label"], top["confidence"], None


_instance: YoloDetector | None = None
_instance_lock = threading.Lock()
_logged_missing = False


def get_detector(model_dir: Path | None = None) -> YoloDetector | None:
    """Lazy singleton. None when the .onnx is not staged (no heavy imports)."""
    global _instance, _logged_missing
    if _instance is not None:
        return _instance
    path = find_weights_path(model_dir)
    if path is None:
        base = model_dir or _model_dir()
        if not _logged_missing:
            logger.info("stage-1: no YOLO weights in %s (want %s)", base, ONNX_NAME)
            _logged_missing = True
        return None
    with _instance_lock:
        if _instance is None:
            _instance = YoloDetector(path)
    return _instance


def reset_detector() -> None:
    """Test hook: drop the singleton."""
    global _instance, _logged_missing
    with _instance_lock:
        _instance = None
        _logged_missing = False
