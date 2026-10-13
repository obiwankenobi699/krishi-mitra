from io import BytesIO

from fastapi import HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from ..config import settings


ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
ALLOWED_AUDIO_TYPES = {
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
}


async def read_limited(upload: UploadFile) -> bytes:
    content = await upload.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Upload exceeds the configured size limit")
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")
    return content


def validate_image(content: bytes, content_type: str | None) -> str:
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Only JPEG, PNG, and WebP images are accepted")
    expected = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}[content_type]
    try:
        with Image.open(BytesIO(content)) as image:
            image.verify()
            if image.format != expected:
                raise HTTPException(
                    status_code=415, detail="Image content does not match its media type"
                )
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="The uploaded image is invalid") from exc
    return ALLOWED_IMAGE_TYPES[content_type]
