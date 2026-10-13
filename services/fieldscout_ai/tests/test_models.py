import asyncio
import io
import unittest

from fastapi import HTTPException

from services.fieldscout_ai.app.models import AnalysisMode, VisionAnalysis
from services.shared.core.uploads import read_limited_upload


class AsyncUploadStub:
    def __init__(self, content: bytes, content_type: str) -> None:
        self._file = io.BytesIO(content)
        self.content_type = content_type

    async def read(self, size: int) -> bytes:
        return self._file.read(size)


class VisionAnalysisTests(unittest.TestCase):
    def test_accepts_a_bounded_structured_result(self) -> None:
        result = VisionAnalysis.model_validate(
            {
                "analysis_mode": AnalysisMode.disease_diagnosis,
                "crop": "Tomato",
                "condition": "Possible early blight",
                "confidence": 0.72,
                "severity": "medium",
                "observations": ["Brown leaf spots"],
                "recommended_actions": ["Ask a local agronomist to confirm"],
                "needs_expert_review": True,
                "summary": "Visible symptoms may be consistent with early blight.",
            }
        )

        self.assertEqual(result.crop, "Tomato")
        self.assertTrue(result.needs_expert_review)

    def test_rejects_confidence_outside_zero_to_one(self) -> None:
        with self.assertRaises(ValueError):
            VisionAnalysis.model_validate(
                {
                    "analysis_mode": "crop_identification",
                    "condition": "Unknown",
                    "confidence": 1.2,
                    "summary": "Unable to identify the crop.",
                }
            )


class UploadValidationTests(unittest.TestCase):
    def test_rejects_an_oversized_upload(self) -> None:
        upload = AsyncUploadStub(b"12345", "image/jpeg")

        with self.assertRaises(HTTPException) as raised:
            asyncio.run(
                read_limited_upload(
                    upload,
                    max_bytes=4,
                    allowed_content_types={"image/jpeg"},
                )
            )

        self.assertEqual(raised.exception.status_code, 413)

    def test_rejects_an_unsupported_media_type(self) -> None:
        upload = AsyncUploadStub(b"text", "text/plain")

        with self.assertRaises(HTTPException) as raised:
            asyncio.run(
                read_limited_upload(
                    upload,
                    max_bytes=100,
                    allowed_content_types={"image/jpeg"},
                )
            )

        self.assertEqual(raised.exception.status_code, 415)


if __name__ == "__main__":
    unittest.main()
