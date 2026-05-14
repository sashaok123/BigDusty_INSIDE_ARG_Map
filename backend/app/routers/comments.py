"""Canvas comment pins. Anyone can read; authed users can create + reply."""

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_current_user
from ..models import CanvasComment, User
from ..schemas import (
    CommentCreateRequest,
    CommentOut,
    CommentReplyRequest,
)

router = APIRouter(tags=["comments"])


def _comment_out(row: CanvasComment) -> CommentOut:
    return CommentOut(
        id=row.id,
        canvas_id=row.canvas_id,
        x=row.x,
        y=row.y,
        thread=row.thread or [],
        created_at=row.created_at,
    )


@router.get("/canvas/{canvas_id}/comments", response_model=list[CommentOut])
async def list_comments(canvas_id: str, db: Annotated[AsyncSession, Depends(get_db)]) -> list[CommentOut]:
    result = await db.scalars(
        select(CanvasComment).where(CanvasComment.canvas_id == canvas_id).order_by(CanvasComment.created_at)
    )
    return [_comment_out(r) for r in result.all()]


@router.post("/canvas/{canvas_id}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def create_comment(
    canvas_id: str,
    payload: CommentCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> CommentOut:
    now = datetime.now(timezone.utc).isoformat()
    msg = {"author": user.username_display, "body": payload.body, "at": now}
    row = CanvasComment(
        canvas_id=canvas_id,
        x=payload.x,
        y=payload.y,
        thread=[msg],
        created_by_user_id=user.id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _comment_out(row)


@router.post("/canvas/{canvas_id}/comments/{comment_id}/reply", response_model=CommentOut)
async def reply_to_comment(
    canvas_id: str,
    comment_id: uuid.UUID,
    payload: CommentReplyRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> CommentOut:
    row = await db.scalar(
        select(CanvasComment).where(
            CanvasComment.id == comment_id, CanvasComment.canvas_id == canvas_id
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    now = datetime.now(timezone.utc).isoformat()
    msg = {"author": user.username_display, "body": payload.body, "at": now}
    thread = list(row.thread or [])
    thread.append(msg)
    row.thread = thread
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(row, "thread")
    await db.commit()
    await db.refresh(row)
    return _comment_out(row)
