from io import BytesIO

import pytest
from fastapi import HTTPException
from PIL import Image

from app.services.uploads import validate_image
from app.services.ai import database_severity, extract_analysis


def image_bytes(image_format: str) -> bytes:
    output = BytesIO()
    Image.new("RGB", (2, 2), "green").save(output, format=image_format)
    return output.getvalue()


def test_validate_image_accepts_matching_image():
    assert validate_image(image_bytes("PNG"), "image/png") == ".png"


def test_validate_image_rejects_spoofed_content_type():
    with pytest.raises(HTTPException) as exc:
        validate_image(image_bytes("PNG"), "image/jpeg")
    assert exc.value.status_code == 415


def test_validate_image_rejects_invalid_data():
    with pytest.raises(HTTPException) as exc:
        validate_image(b"not-an-image", "image/jpeg")
    assert exc.value.status_code == 400


def test_analysis_normalization_preserves_result_and_maps_database_severity():
    analysis = extract_analysis({"severity": "none", "summary": "Healthy crop"})

    assert analysis["severity"] == "none"
    assert database_severity(analysis) == "unknown"
