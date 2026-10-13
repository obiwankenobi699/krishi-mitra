from collections.abc import Collection

from fastapi import HTTPException, UploadFile, status


async def read_limited_upload(
    upload: UploadFile,
    *,
    max_bytes: int,
    allowed_content_types: Collection[str],
) -> bytes:
    """Read an upload without allowing an unbounded request body into memory."""
    if upload.content_type not in allowed_content_types:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported media type: {upload.content_type or 'unknown'}",
        )

    data = bytearray()
    while chunk := await upload.read(min(1024 * 1024, max_bytes + 1 - len(data))):
        data.extend(chunk)
        if len(data) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Upload exceeds the {max_bytes // (1024 * 1024)} MB limit",
            )

    if not data:
        raise HTTPException(status_code=422, detail="The uploaded file is empty")
    return bytes(data)
