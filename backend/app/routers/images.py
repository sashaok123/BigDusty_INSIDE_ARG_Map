"""Media upload and serving endpoints. Bytes are stored in Postgres as bytea
with sha256 dedupe; media items are served with immutable cache headers.
The same table holds images, short video clips (mp4/webm), audio files, and
small document files (html/json/text/pdf) for the in-canvas file viewer."""

import hashlib
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import log_action
from ..database import get_db
from ..deps import get_current_user, require_admin
from ..models import CanvasImage, User

router = APIRouter(tags=["media"])

ALLOWED_IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp"}
ALLOWED_VIDEO_MIMES = {"video/mp4", "video/webm"}
ALLOWED_AUDIO_MIMES = {"audio/mpeg", "audio/mp3", "audio/ogg", "audio/wav", "audio/x-wav", "audio/webm", "audio/aac", "audio/flac"}
ALLOWED_DOC_MIMES = {
    "text/html",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "application/xml",
    "text/xml",
    "application/pdf",
}
ALLOWED_MIMES = ALLOWED_IMAGE_MIMES | ALLOWED_VIDEO_MIMES | ALLOWED_AUDIO_MIMES | ALLOWED_DOC_MIMES
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_VIDEO_BYTES = 100 * 1024 * 1024
MAX_AUDIO_BYTES = 50 * 1024 * 1024
MAX_DOC_BYTES = 5 * 1024 * 1024


def _max_bytes_for(mime: str) -> int:
    if mime in ALLOWED_VIDEO_MIMES:
        return MAX_VIDEO_BYTES
    if mime in ALLOWED_AUDIO_MIMES:
        return MAX_AUDIO_BYTES
    if mime in ALLOWED_DOC_MIMES:
        return MAX_DOC_BYTES
    return MAX_IMAGE_BYTES


def _audit_action_for(mime: str) -> str:
    if mime in ALLOWED_VIDEO_MIMES:
        return "video_uploaded"
    if mime in ALLOWED_AUDIO_MIMES:
        return "audio_uploaded"
    if mime in ALLOWED_DOC_MIMES:
        return "document_uploaded"
    return "image_uploaded"


def _image_url(canvas_id: str, image_id: uuid.UUID) -> str:
    return f"/canvas/{canvas_id}/images/{image_id}"


def _is_truthy(value: str | None) -> bool:
    if not value:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


@router.post("/canvas/{canvas_id}/images", status_code=status.HTTP_201_CREATED)
async def upload_image(
    canvas_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    file: UploadFile = File(...),
    keep_original: Annotated[str | None, Form()] = None,
    original: UploadFile | None = File(default=None),
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
    max_bytes = _max_bytes_for(mime)
    if size > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Media too large ({size} bytes, max {max_bytes})",
        )
    retain = _is_truthy(keep_original)
    original_bytes: bytes | None = None
    original_mime: str | None = None
    original_size: int | None = None
    if retain and original is not None:
        original_bytes = await original.read()
        if original_bytes:
            original_mime = (original.content_type or "").lower().split(";")[0].strip() or None
            original_size = len(original_bytes)
            original_max = _max_bytes_for(original_mime or mime)
            if original_size > original_max:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"Original too large ({original_size} bytes, max {original_max})",
                )
        else:
            original_bytes = None
    digest = hashlib.sha256(contents).hexdigest()
    existing = await db.scalar(select(CanvasImage).where(CanvasImage.sha256 == digest))
    if existing is not None:
        if original_bytes and existing.original_data is None:
            existing.original_data = original_bytes
            existing.original_size = original_size
            existing.original_mime = original_mime
            await db.commit()
            await db.refresh(existing)
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
        original_data=original_bytes,
        original_size=original_size,
        original_mime=original_mime,
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
    action = _audit_action_for(mime)
    payload = {"media_id": str(record.id), "mime": record.mime, "size": record.size, "sha256": record.sha256}
    if original_bytes:
        payload["original_retained"] = True
        payload["original_size"] = original_size
    await log_action(db, user.id, action, payload)
    await db.commit()
    return {
        "id": str(record.id),
        "url": _image_url(canvas_id, record.id),
        "sha256": record.sha256,
        "mime": record.mime,
        "size": record.size,
    }


@router.post("/canvas/{canvas_id}/images/{image_id}/restore_original")
async def restore_original(
    canvas_id: str,
    image_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(require_admin)],
) -> dict:
    record = await db.scalar(select(CanvasImage).where(CanvasImage.id == image_id))
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    if record.original_data is None or record.original_size is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no_original")
    new_data = record.original_data
    new_size = record.original_size
    new_mime = record.original_mime or record.mime
    new_digest = hashlib.sha256(new_data).hexdigest()
    record.data = new_data
    record.size = new_size
    record.mime = new_mime
    record.sha256 = new_digest
    record.original_data = None
    record.original_size = None
    record.original_mime = None
    await log_action(db, user.id, "image_original_restored", {
        "media_id": str(record.id),
        "mime": record.mime,
        "size": record.size,
        "sha256": record.sha256,
    })
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="sha256_conflict")
    await db.refresh(record)
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
    mime = (record.mime or "").lower()
    is_inline = mime.startswith("image/") or mime == "application/pdf"
    headers = {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": str(record.size),
        "X-Image-Sha256": record.sha256,
        "X-Content-Type-Options": "nosniff",
    }
    if not is_inline:
        headers["Content-Disposition"] = "attachment"
    return Response(
        content=record.data,
        media_type=record.mime,
        headers=headers,
    )
