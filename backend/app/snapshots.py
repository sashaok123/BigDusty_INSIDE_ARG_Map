"""Helpers for canvas snapshot history. A snapshot row is inserted on every
mutation that bumps the canvas revision; the last MAX_SNAPSHOTS rows per
canvas are kept and older rows are deleted in the same transaction."""

import uuid
from copy import deepcopy
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Canvas, CanvasSnapshot, User

MAX_SNAPSHOTS = 200


async def write_snapshot(
    db: AsyncSession,
    canvas: Canvas,
    user: User | None,
    action_label: str,
) -> CanvasSnapshot:
    snap = CanvasSnapshot(
        canvas_id=canvas.id,
        revision=canvas.revision,
        data=deepcopy(canvas.data or {}),
        comment=action_label,
        created_by_user_id=user.id if user is not None else None,
    )
    db.add(snap)
    return snap


async def prune_snapshots(db: AsyncSession, canvas_id: str) -> int:
    rows = (await db.scalars(
        select(CanvasSnapshot.id)
        .where(CanvasSnapshot.canvas_id == canvas_id)
        .order_by(CanvasSnapshot.created_at.desc())
        .offset(MAX_SNAPSHOTS)
    )).all()
    if not rows:
        return 0
    await db.execute(delete(CanvasSnapshot).where(CanvasSnapshot.id.in_(rows)))
    return len(rows)


async def list_snapshots(db: AsyncSession, canvas_id: str) -> list[dict[str, Any]]:
    rows = (await db.scalars(
        select(CanvasSnapshot)
        .where(CanvasSnapshot.canvas_id == canvas_id)
        .order_by(CanvasSnapshot.created_at.desc())
        .limit(MAX_SNAPSHOTS)
    )).all()
    user_ids = {r.created_by_user_id for r in rows if r.created_by_user_id is not None}
    user_map: dict[uuid.UUID, str] = {}
    if user_ids:
        users = (await db.scalars(select(User).where(User.id.in_(user_ids)))).all()
        user_map = {u.id: u.username_display for u in users}
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append({
            "id": r.id,
            "revision": r.revision,
            "created_at": r.created_at,
            "created_by": user_map.get(r.created_by_user_id) if r.created_by_user_id else None,
            "comment": r.comment,
        })
    return out


async def get_snapshot(
    db: AsyncSession, canvas_id: str, snapshot_id: uuid.UUID
) -> dict[str, Any] | None:
    row = await db.scalar(
        select(CanvasSnapshot).where(
            CanvasSnapshot.id == snapshot_id, CanvasSnapshot.canvas_id == canvas_id
        )
    )
    if row is None:
        return None
    user_display = None
    if row.created_by_user_id is not None:
        u = await db.scalar(select(User).where(User.id == row.created_by_user_id))
        if u is not None:
            user_display = u.username_display
    return {
        "id": row.id,
        "canvas_id": row.canvas_id,
        "revision": row.revision,
        "data": deepcopy(row.data or {}),
        "comment": row.comment,
        "created_by": user_display,
        "created_at": row.created_at,
    }
