"""Stage-1 classifier tests. TF/GPU/weights NOT required (weights-absent paths)."""

import base64
import io
import sys
import unittest

from PIL import Image

from services.fieldscout_ai.app.models import AnalysisMode, VisionAnalysis
from services.fieldscout_ai.app.services import resnet_classifier as rc
from services.fieldscout_ai.app.services.vision_service import (
    STAGE1_MODEL_NAME_TF,
    VisionService,
    _local_classify,
)


def _png_bytes(color=(34, 139, 34), size=(300, 300)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


class PlantVillageConstantsTests(unittest.TestCase):
    def test_38_classes_in_canonical_order(self) -> None:
        self.assertEqual(len(rc.PLANTVILLAGE_CLASSES), 38)
        self.assertEqual(len(set(rc.PLANTVILLAGE_CLASSES)), 38)
        self.assertTrue(all("___" in c for c in rc.PLANTVILLAGE_CLASSES))
        self.assertEqual(rc.PLANTVILLAGE_CLASSES[0], "Apple___Apple_scab")
        self.assertEqual(rc.PLANTVILLAGE_CLASSES[-1], "Tomato___healthy")


class WeightsAbsentTests(unittest.TestCase):
    def test_no_weights_without_tf_import(self) -> None:
        rc.reset_classifier()
        try:
            self.assertNotIn("tensorflow", sys.modules)
            self.assertIsNone(rc.get_classifier())
            self.assertIsNone(_local_classify(_png_bytes()))
            self.assertNotIn("tensorflow", sys.modules)
        finally:
            rc.reset_classifier()

    def test_service_stays_torch_free(self) -> None:
        rc.reset_classifier()
        try:
            _local_classify(_png_bytes())
        finally:
            rc.reset_classifier()
        self.assertNotIn("torch", sys.modules)


class MaskBboxTests(unittest.TestCase):
    def test_none_mask_gives_none_bbox(self) -> None:
        self.assertIsNone(rc.mask_to_bbox(None))
        self.assertIsNone(rc.mask_to_bbox("not-base64!!!"))

    def test_hot_spot_bbox_is_normalized(self) -> None:
        import numpy as np

        heat = np.zeros((64, 64), dtype=np.uint8)
        heat[16:32, 8:24] = 255
        buf = io.BytesIO()
        Image.fromarray(heat).save(buf, format="PNG")
        bbox = rc.mask_to_bbox(base64.b64encode(buf.getvalue()).decode("ascii"))
        self.assertIsNotNone(bbox)
        assert bbox is not None
        x, y, w, h = bbox
        for v in (x, y, w, h):
            self.assertGreaterEqual(v, 0.0)
            self.assertLessEqual(v, 1.0)
        self.assertGreater(w, 0)
        self.assertGreater(h, 0)
        # Hot block at cols 8-24 / rows 16-32 of 64px.
        self.assertAlmostEqual(x, 8 / 64, places=2)
        self.assertAlmostEqual(y, 16 / 64, places=2)


class ClassifierFirstContractTests(unittest.TestCase):
    def test_classifier_first_result_validates(self) -> None:
        result = VisionService._classifier_first_result(
            ("Tomato___Early_blight", 0.87, None), AnalysisMode.disease_diagnosis
        )
        validated = VisionAnalysis.model_validate(result.model_dump())
        self.assertEqual(validated.condition, "Early blight")
        self.assertEqual(validated.crop, "Tomato")
        self.assertAlmostEqual(validated.confidence, 0.87)
        self.assertEqual(len(validated.regions), 1)
        box = validated.regions[0]
        self.assertEqual((box.x, box.y, box.width, box.height), (0.1, 0.1, 0.8, 0.8))
        self.assertEqual(validated.stage1_model, STAGE1_MODEL_NAME_TF)
        self.assertTrue(validated.needs_expert_review)
        self.assertTrue(validated.observations)
        self.assertTrue(validated.recommended_actions)
        self.assertTrue(validated.summary)

    def test_healthy_high_confidence_shape(self) -> None:
        result = VisionService._classifier_first_result(
            ("Apple___healthy", 0.95, None), AnalysisMode.disease_diagnosis
        )
        self.assertEqual(result.severity, "none")
        self.assertFalse(result.needs_expert_review)
        VisionAnalysis.model_validate(result.model_dump())


if __name__ == "__main__":
    unittest.main()
