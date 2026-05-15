"""Public share-link routes. Read-only canvas access via a time-limited token."""

from copy import deepcopy
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Canvas, ShareLink
from ..schemas import ShareLinkCanvasOut

router = APIRouter(prefix="/share", tags=["share"])


def _ensure_lists(data: dict) -> dict:
    if not isinstance(data, dict):
        return {"nodes": [], "edges": []}
    data.setdefault("nodes", [])
    data.setdefault("edges", [])
    if not isinstance(data["nodes"], list):
        data["nodes"] = []
    if not isinstance(data["edges"], list):
        data["edges"] = []
    return data


@router.get("/{token}/canvas", response_model=ShareLinkCanvasOut)
async def get_shared_canvas(
    token: str,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ShareLinkCanvasOut:
    row = await db.scalar(select(ShareLink).where(ShareLink.token == token))
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found")
    if row.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Share link revoked")
    if row.expires_at is not None:
        exp = row.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="Share link expired")
    canvas = await db.scalar(select(Canvas).where(Canvas.id == row.canvas_id))
    if canvas is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Canvas not found")
    response.headers["Cache-Control"] = "public, max-age=60"
    return ShareLinkCanvasOut(
        revision=canvas.revision,
        data=_ensure_lists(deepcopy(canvas.data or {})),
        canvas_id=canvas.id,
        readonly=True,
    )
