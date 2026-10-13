"""Local TensorFlow ResNet50 PlantVillage classifier (stage-1 fast path).

GPU-ONLY policy: model load fails fast with RuntimeError when
``tf.config.list_physical_devices('GPU')`` is empty. There is no CPU
fallback — the RTX 3050 4GB must serve inference, and silent CPU
fallback would hide a broken GPU stack behind slow responses.

Weights convention (see also ``services/fieldscout_ai/README.md`` and
``download_model.py``):
    $MODEL_DIR/plantvillage_resnet50.keras   (preferred, Keras v3 format)
    $MODEL_DIR/plantvillage_resnet50.h5      (legacy full-model or weights-only)

Accepted drop-in files (user has a Kaggle ResNet-99.2 checkpoint):
    - ``.keras`` / ``.h5`` full model with a 38-way softmax head
      (any backbone, as long as outputs are the 38 classes below in
      order) — loaded directly via ``tf.keras.models.load_model``.
    - ``.h5`` weights-only for a vanilla ResNet50 + Dense(38, softmax)
      head — loaded into the canonical architecture built here.
    - ``.pth`` (torch) is NOT loadable here: export to ONNX first, then
      convert to a Keras model offline. This service stays torch-free.
    - ``.onnx`` is NOT loadable by TF directly either: convert
      ONNX -> Keras offline (e.g. ``onnx2keras``) and drop the
      resulting ``.keras`` file into ``$MODEL_DIR``.

Preprocessing assumption: the checkpoint must pair with the standard
``tf.keras.applications.resnet50.preprocess_input`` (caffe mode,
BGR + mean subtraction) on 224x224 RGB input. Most Kaggle PlantVillage
ResNet50 notebooks train exactly this way. If accuracy looks wrong,
re-export with that preprocessing.

No weights are auto-downloaded: no open/commercial-safe TF-native
PlantVillage ResNet50 checkpoint with a model card + metrics + license
was found on HuggingFace at build time (checked 2026-10-11: the only
ResNet50/PlantVillage hits were torch/transformers checkpoints such as
``mesabo/agri-plant-disease-resnet50`` or metric-less uploads). An
env-gated fetch exists for operators who vet a URL themselves:
``FIELDSCOUT_AUTO_DOWNLOAD=1`` + ``FIELDSCOUT_MODEL_URL=<https url>``.
Default OFF.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import threading
import time
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)

INPUT_SIZE = 224
NUM_CLASSES = 38
MODEL_BASENAME = "plantvillage_resnet50"
WEIGHT_FILENAMES = (f"{MODEL_BASENAME}.keras", f"{MODEL_BASENAME}.h5")

AUTO_DOWNLOAD_ENV = "FIELDSCOUT_AUTO_DOWNLOAD"
MODEL_URL_ENV = "FIELDSCOUT_MODEL_URL"

# Canonical 38 PlantVillage classes, in the dataset's standard order.
# A drop-in checkpoint MUST output softmax probabilities in this order
# (unless it is a full model carrying its own equivalent label map —
# predictions are positional, so order matters).
PLANTVILLAGE_CLASSES: list[str] = [
    "Apple___Apple_scab",
    "Apple___Black_rot",
    "Apple___Cedar_apple_rust",
    "Apple___healthy",
    "Blueberry___healthy",
    "Cherry_(including_sour)___Powdery_mildew",
    "Cherry_(including_sour)___healthy",
    "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot",
    "Corn_(maize)___Common_rust_",
    "Corn_(maize)___Northern_Leaf_Blight",
    "Corn_(maize)___healthy",
    "Grape___Black_rot",
    "Grape___Esca_(Black_Measles)",
    "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)",
    "Grape___healthy",
    "Orange___Haunglongbing_(Citrus_greening)",
    "Peach___Bacterial_spot",
    "Peach___healthy",
    "Pepper,_bell___Bacterial_spot",
    "Pepper,_bell___healthy",
    "Potato___Early_blight",
    "Potato___Late_blight",
    "Potato___healthy",
    "Raspberry___healthy",
    "Soybean___healthy",
    "Squash___Powdery_mildew",
    "Strawberry___Leaf_scorch",
    "Strawberry___healthy",
    "Tomato___Bacterial_spot",
    "Tomato___Early_blight",
    "Tomato___Late_blight",
    "Tomato___Leaf_Mold",
    "Tomato___Septoria_leaf_spot",
    "Tomato___Spider_mites Two-spotted_spider_mite",
    "Tomato___Target_Spot",
    "Tomato___Tomato_Yellow_Leaf_Curl_Virus",
    "Tomato___Tomato_mosaic_virus",
    "Tomato___healthy",
]

assert len(PLANTVILLAGE_CLASSES) == NUM_CLASSES


def _model_dir() -> Path:
    from shared.core.config import settings

    return Path(settings.MODEL_DIR)


def find_weights_path(model_dir: Path | None = None) -> Path | None:
    """Return the staged checkpoint path, or None when no weights file exists."""
    base = model_dir or _model_dir()
    for name in WEIGHT_FILENAMES:
        candidate = base / name
        if candidate.is_file():
            return candidate
    return None


def _maybe_auto_download(model_dir: Path) -> Path | None:
    """Env-gated weight fetch. Default OFF — returns staged path or None."""
    staged = find_weights_path(model_dir)
    if staged is not None:
        return staged
    if os.environ.get(AUTO_DOWNLOAD_ENV, "0") != "1":
        return None
    url = os.environ.get(MODEL_URL_ENV, "").strip()
    if not url:
        logger.warning("stage-1: %s=1 but %s is unset; skipping download", AUTO_DOWNLOAD_ENV, MODEL_URL_ENV)
        return None
    suffix = ".onnx" if url.lower().endswith(".onnx") else ".keras"
    dest = model_dir / f"{MODEL_BASENAME}{suffix}"
    logger.info("stage-1: downloading weights %s -> %s", url, dest)
    model_dir.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, dest)  # noqa: S310 — operator-vetted URL only
    return dest if dest.is_file() else None


def _preload_nvidia_libs() -> None:
    """ctypes-preload CUDA wheel libs so TF finds them without LD_LIBRARY_PATH.

    The ``nvidia-*`` pip wheels ship .so files under
    ``site-packages/nvidia/*/lib``, which the dynamic linker does not
    search by default. Pre-loading by absolute path puts the sonames in
    the process so TensorFlow's later dlopen() calls resolve. Live
    services (which may not set LD_LIBRARY_PATH) need this; harmless
    when the libs are already discoverable. Never raises.
    """
    import ctypes
    import site
    import sysconfig

    candidates = {sysconfig.get_path("purelib")}
    try:
        candidates.update(site.getsitepackages())
    except Exception:
        pass
    for base in sorted(candidates):
        libdir = Path(base) / "nvidia"
        if not libdir.is_dir():
            continue
        for so in sorted(libdir.glob("*/lib/lib*.so*")):
            if so.is_symlink():
                continue  # versioned target gets loaded directly
            try:
                ctypes.CDLL(str(so), mode=ctypes.RTLD_GLOBAL)
            except Exception:
                continue  # linker scripts / arch mismatches are skipped


def _import_tf():
    _preload_nvidia_libs()
    import tensorflow as tf

    return tf


def mask_to_bbox(mask_b64: str | None) -> tuple[float, float, float, float] | None:
    """Bounding box (normalized x, y, w, h) of the hot area of a mask.

    Returns None when the mask is missing/undecodable/empty, letting the
    caller fall back to the full-frame contract box.
    """
    if not mask_b64:
        return None
    try:
        import numpy as np
        from PIL import Image

        raw = base64.b64decode(mask_b64)
        with Image.open(io.BytesIO(raw)) as img:
            heat = np.asarray(img.convert("L"), dtype=np.float32) / 255.0
        if heat.size == 0:
            return None
        ys, xs = (heat > 0.5 * float(heat.max())).nonzero() if heat.max() > 0 else ([], [])
        if len(xs) == 0:
            return None
        h, w = heat.shape
        x0, x1 = float(xs.min()) / w, (float(xs.max()) + 1) / w
        y0, y1 = float(ys.min()) / h, (float(ys.max()) + 1) / h
        return (x0, y0, max(0.01, x1 - x0), max(0.01, y1 - y0))
    except Exception as exc:  # never break diagnosis on overlay math
        logger.debug("stage-1: mask bbox failed: %s", exc)
        return None


class ResNetClassifier:
    """Lazy TensorFlow ResNet50 wrapper. Construct via get_classifier()."""

    def __init__(self, weights_path: Path) -> None:
        tf = _import_tf()

        gpus = tf.config.list_physical_devices("GPU")
        if not gpus:
            raise RuntimeError(
                "GPU-only policy: no CUDA device visible to TensorFlow "
                "(tf.config.list_physical_devices('GPU') is empty). "
                "Refusing CPU fallback."
            )
        logger.info("stage-1: GPUs visible: %s", [d.name for d in gpus])
        self._tf = tf
        self.weights_path = weights_path
        self.model = self._load_model(tf, weights_path)
        self._lock = threading.Lock()
        self.last_latency_s: float | None = None

    @staticmethod
    def _build_canonical(tf) -> "object":  # tf.keras.Model
        base = tf.keras.applications.ResNet50(
            include_top=False, weights=None, input_shape=(INPUT_SIZE, INPUT_SIZE, 3), pooling="avg"
        )
        outputs = tf.keras.layers.Dense(NUM_CLASSES, activation="softmax", name="plantvillage_head")(
            base.output
        )
        return tf.keras.Model(inputs=base.input, outputs=outputs)

    def _load_model(self, tf, weights_path: Path):
        # Prefer full-model load (handles any head/arch with 38 outputs);
        # fall back to weights-only load into the canonical ResNet50.
        try:
            model = tf.keras.models.load_model(str(weights_path))
            logger.info("stage-1: loaded full model %s", weights_path)
            return model
        except Exception as exc:
            logger.info("stage-1: full-model load failed (%s); trying weights-only", exc)
        model = self._build_canonical(tf)
        try:
            model.load_weights(str(weights_path))
        except Exception as exc:
            raise RuntimeError(
                f"Could not load {weights_path} as a full model or as "
                f"ResNet50+head weights: {exc}. See accepted formats in "
                "services/fieldscout_ai/README.md."
            ) from exc
        logger.info("stage-1: loaded weights-only checkpoint %s", weights_path)
        return model

    def _preprocess(self, tf, image_bytes: bytes):
        from PIL import Image

        with Image.open(io.BytesIO(image_bytes)) as img:
            img = img.convert("RGB").resize((INPUT_SIZE, INPUT_SIZE))
            import numpy as np

            arr = np.asarray(img, dtype=np.float32)
        batch = tf.expand_dims(arr, 0)
        return tf.keras.applications.resnet50.preprocess_input(batch)

    def predict(self, image_bytes: bytes) -> tuple[str, float]:
        """Return (label, confidence) for raw image bytes."""
        tf = self._tf
        inputs = self._preprocess(tf, image_bytes)
        start = time.perf_counter()
        with self._lock:
            probs = self.model(inputs, training=False).numpy()[0]
        self.last_latency_s = time.perf_counter() - start
        idx = int(probs.argmax())
        label = PLANTVILLAGE_CLASSES[idx] if idx < len(PLANTVILLAGE_CLASSES) else f"class_{idx}"
        conf = float(min(1.0, max(0.0, probs[idx])))
        logger.info("stage-1: %s %.3f (%.1f ms)", label, conf, self.last_latency_s * 1000)
        return label, conf

    def gradcam_mask(self, image_bytes: bytes, size: int = 64) -> str | None:
        """Grad-CAM PNG mask (base64) for the top predicted class.

        The frontend renders region boxes (not this mask directly); the
        mask's hot-area bbox becomes the SVG overlay box. Returns None
        when the model has no Conv2D layer or attribution fails.
        """
        import numpy as np
        from PIL import Image

        tf = self._tf
        inputs = self._preprocess(tf, image_bytes)
        last_conv = next(
            (layer for layer in reversed(self.model.layers) if "conv2d" in layer.__class__.__name__.lower()),
            None,
        )
        if last_conv is None:
            logger.warning("stage-1: no Conv2D layer found; skipping Grad-CAM")
            return None
        try:
            grad_model = tf.keras.Model(self.model.inputs, [last_conv.output, self.model.output])
            with tf.GradientTape() as tape:
                conv_out, preds = grad_model(inputs, training=False)
                pred_idx = int(tf.argmax(preds[0]))
                loss = preds[:, pred_idx]
            grads = tape.gradient(loss, conv_out)
            weights = tf.reduce_mean(grads, axis=(1, 2))
            cam = tf.reduce_sum(conv_out * weights[:, tf.newaxis, tf.newaxis, :], axis=-1)
            cam = tf.nn.relu(cam)[0].numpy()
            cam = (cam - cam.min()) / (cam.max() - cam.min() + 1e-8)
            heat = np.uint8(255 * cam)
            with Image.fromarray(heat).resize((size, size)) as thumb:
                buf = io.BytesIO()
                thumb.save(buf, format="PNG")
            return base64.b64encode(buf.getvalue()).decode("ascii")
        except Exception as exc:
            logger.warning("stage-1: Grad-CAM failed: %s", exc)
            return None

    def classify(self, image_bytes: bytes) -> tuple[str, float, str | None]:
        """Return (label, confidence, mask_b64|None). Never raises on image issues."""
        label, conf = self.predict(image_bytes)
        try:
            mask = self.gradcam_mask(image_bytes)
        except Exception as exc:  # mask is overlay-only; keep the prediction
            logger.warning("stage-1: mask skipped: %s", exc)
            mask = None
        return label, conf, mask


_instance: ResNetClassifier | None = None
_instance_lock = threading.Lock()
_logged_missing = False


def get_classifier(model_dir: Path | None = None) -> ResNetClassifier | None:
    """Lazy singleton. Returns None (no TF import) when no weights staged."""
    global _instance, _logged_missing
    if _instance is not None:
        return _instance
    base = model_dir or _model_dir()
    path = _maybe_auto_download(base)
    if path is None:
        if not _logged_missing:
            logger.info(
                "stage-1: no weights in %s (want %s); using VLM region proposals. "
                "See services/fieldscout_ai/README.md for the drop-in.",
                base,
                " or ".join(WEIGHT_FILENAMES),
            )
            _logged_missing = True
        return None
    with _instance_lock:
        if _instance is None:
            _instance = ResNetClassifier(path)
    return _instance


def reset_classifier() -> None:
    """Test hook: drop the singleton."""
    global _instance, _logged_missing
    with _instance_lock:
        _instance = None
        _logged_missing = False
