"""Media upload and serving endpoints. Bytes are stored in Postgres as bytea
with sha256 dedupe; media items are served with immutable cache headers.
The same table holds images and short video clips (mp4/webm up to 100 MB)."""

import hashlib
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import log_action
from ..database import get_db
from ..deps import get_current_user
from ..models import CanvasImage, User

router = APIRouter(tags=["media"])

ALLOWED_IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp"}
ALLOWED_VIDEO_MIMES = {"video/mp4", "video/webm"}
ALLOWED_MIMES = ALLOWED_IMAGE_MIMES | ALLOWED_VIDEO_MIMES
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_VIDEO_BYTES = 100 * 1024 * 1024


def _image_url(canvas_id: str, image_id: uuid.UUID) -> str:
    return f"/canvas/{canvas_id}/images/{image_id}"


@router.post("/canvas/{canvas_id}/images", status_code=status.HTTP_201_CREATED)
async def upload_image(
    canvas_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    file: UploadFile = File(...),
) -> dict:
    mime = (file.content_type or "").lower().split(";")[0].strip()
    if mime not in ALLOWED_MIMES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported media type: {mime or 'unknown'}",
        )
    contents = await file.read()
    size = len(contents)
    if size == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    max_bytes = MAX_VIDEO_BYTES if mime in ALLOWED_VIDEO_MIMES else MAX_IMAGE_BYTES
    if size > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Media too large ({size} bytes, max {max_bytes})",
        )
    digest = hashlib.sha256(contents).hexdigest()
    existing = await db.scalar(select(CanvasImage).where(CanvasImage.sha256 == digest))
    if existing is not None:
        return {
            "id": str(existing.id),
            "url": _image_url(canvas_id, existing.id),
            "sha256": existing.sha256,
            "mime": existing.mime,
            "size": existing.size,
        }
    record = CanvasImage(
        sha256=digest,
        mime=mime,
        size=size,
        data=contents,
        created_by_user_id=user.id,
    )
    db.add(record)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        again = await db.scalar(select(CanvasImage).where(CanvasImage.sha256 == digest))
        if again is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Image conflict")
        return {
            "id": str(again.id),
            "url": _image_url(canvas_id, again.id),
            "sha256": again.sha256,
            "mime": again.mime,
            "size": again.size,
        }
    await db.refresh(record)
    action = "video_uploaded" if mime in ALLOWED_VIDEO_MIMES else "image_uploaded"
    await log_action(db, user.id, action, {"media_id": str(record.id), "mime": record.mime, "size": record.size, "sha256": record.sha256})
    await db.commit()
    return {
        "id": str(record.id),
        "url": _image_url(canvas_id, record.id),
        "sha256": record.sha256,
        "mime": record.mime,
        "size": record.size,
    }


@router.get("/canvas/{canvas_id}/images/{image_id}")
async def get_image(
    canvas_id: str,
    image_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    record = await db.scalar(select(CanvasImage).where(CanvasImage.id == image_id))
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    return Response(
        content=record.data,
        media_type=record.mime,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Length": str(record.size),
            "X-Image-Sha256": record.sha256,
        },
    )
