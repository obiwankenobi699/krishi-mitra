"""Stage-1 weights helper for FieldScout AI.

Reports YOLOv11x detector status (primary) and ResNet fallback status.
No downloads unless explicitly env-gated (default OFF — no mystery weights).

Primary convention:
    $MODEL_DIR/yolo11-plant/plantvillage_yolo11x.onnx + labels.json

Usage:
    PYTHONPATH=<repo-root>/services MODEL_DIR=/models python download_model.py
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from services.fieldscout_ai.app.services.yolo_detector import (  # noqa: E402
    LABELS_NAME,
    ONNX_NAME,
    find_weights_path as find_yolo_weights,
    load_labels,
)
from services.fieldscout_ai.app.services.resnet_classifier import (  # noqa: E402
    WEIGHT_FILENAMES,
    find_weights_path,
)


def main() -> int:
    model_dir = Path(os.environ.get("MODEL_DIR", "/models"))
    yolo = find_yolo_weights()
    if yolo is not None:
        labels = load_labels(yolo.parent)
        print(f"YOLO detector ready: {yolo} ({yolo.stat().st_size / 1e6:.1f} MB, "
              f"{len(labels)} classes)")
        return 0
    print(f"No YOLO weights under {model_dir} (want yolo11-plant/{ONNX_NAME} + {LABELS_NAME}).")
    found = find_weights_path(model_dir)
    if found is not None:
        print(f"ResNet fallback ready: {found} ({found.stat().st_size / 1e6:.1f} MB)")
        return 0
    print(f"No stage-1 weights in {model_dir} (want one of: {', '.join(WEIGHT_FILENAMES)}).")
    print("Drop your PlantVillage ResNet50 checkpoint there and restart fieldscout_ai.")
    print("See services/fieldscout_ai/README.md for accepted formats.")
    if os.environ.get("FIELDSCOUT_AUTO_DOWNLOAD", "0") == "1":
        print("NOTE: FIELDSCOUT_AUTO_DOWNLOAD=1 but FIELDSCOUT_MODEL_URL is unset — nothing to fetch.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
