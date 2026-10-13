"""Tests for the YOLOv11x ONNX detector (no weights required for most tests)."""

import io
import unittest

from PIL import Image


def _blank_jpeg(color=(114, 114, 114), size=(64, 48)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="JPEG")
    return buf.getvalue()


class YoloDetectorContractTests(unittest.TestCase):
    def test_labels_map_loads(self):
        from services.fieldscout_ai.app.services import yolo_detector as yd

        labels = yd.load_labels()
        if not labels:
            self.skipTest("no labels.json staged (weights absent)")
        self.assertGreater(len(labels), 100)
        self.assertTrue(all(isinstance(v, str) and v for v in labels.values()))

    def test_module_constants(self):
        from services.fieldscout_ai.app.services import yolo_detector as yd

        self.assertEqual(yd.INPUT_SIZE, 640)
        self.assertTrue(yd.ONNX_NAME.endswith(".onnx"))
        self.assertGreater(yd.CONF_THRESHOLD, 0)

    def test_get_detector_none_without_weights(self):
        from services.fieldscout_ai.app.services import yolo_detector as yd

        yd.reset_detector()
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            from pathlib import Path

            self.assertIsNone(yd.find_weights_path(Path(tmp)))
        yd.reset_detector()


class YoloNmsTests(unittest.TestCase):
    def test_nms_empty(self):
        from services.fieldscout_ai.app.services.yolo_detector import _nms

        self.assertEqual(_nms([], [], 0.45), [])

    def test_nms_suppresses_overlap(self):
        from services.fieldscout_ai.app.services.yolo_detector import _nms

        boxes = [[0, 0, 10, 10], [1, 1, 11, 11], [50, 50, 60, 60]]
        kept = _nms(boxes, [0.9, 0.8, 0.7], 0.45)
        self.assertIn(0, kept)
        self.assertNotIn(1, kept)
        self.assertIn(2, kept)


if __name__ == "__main__":
    unittest.main()
