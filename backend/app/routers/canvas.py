"""Canvas REST endpoints and the WebSocket broadcast channel."""

import uuid
from copy import deepcopy
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import log_action
from ..database import get_db, get_session_factory
from ..deps import get_current_user
from ..models import Canvas, User
from ..schemas import (
    CanvasOut,
    CanvasReplaceRequest,
    CanvasRevisionOut,
    EdgeCreateRequest,
    EdgePatchRequest,
    NodeCreateRequest,
    NodePatchRequest,
)
from ..security import decode_token
from ..ws import manager

router = APIRouter(tags=["canvas"])


def _ensure_lists(data: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {"nodes": [], "edges": []}
    data.setdefault("nodes", [])
    data.setdefault("edges", [])
    if not isinstance(data["nodes"], list):
        data["nodes"] = []
    if not isinstance(data["edges"], list):
        data["edges"] = []
    return data


def _index_of(items: list[dict], item_id: str) -> int:
    for i, it in enumerate(items):
        if isinstance(it, dict) and it.get("id") == item_id:
            return i
    return -1


async def _load_canvas(db: AsyncSession, canvas_id: str) -> Canvas:
    canvas = await db.scalar(select(Canvas).where(Canvas.id == canvas_id))
    if canvas is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Canvas not found")
    return canvas


def _mark_dirty(canvas: Canvas, key: str = "data") -> None:
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(canvas, key)


async def _bump_and_broadcast(
    db: AsyncSession,
    canvas: Canvas,
    user: User,
    kind: str,
    item_id: str | None,
    item_data: dict | None,
) -> int:
    canvas.revision = (canvas.revision or 0) + 1
    canvas.updated_by_user_id = user.id
    _mark_dirty(canvas)
    await db.commit()
    await db.refresh(canvas)
    await manager.broadcast(
        canvas.id,
        {
            "type": "revision",
            "revision": canvas.revision,
            "change": {"kind": kind, "id": item_id, "data": item_data},
            "by": user.username_display,
        },
    )
    return canvas.revision


@router.get("/canvas/{canvas_id}", response_model=CanvasOut)
async def get_canvas(canvas_id: str, db: Annotated[AsyncSession, Depends(get_db)]) -> CanvasOut:
    canvas = await _load_canvas(db, canvas_id)
    return CanvasOut(revision=canvas.revision, data=_ensure_lists(deepcopy(canvas.data or {})))


@router.get("/canvas/{canvas_id}/revision", response_model=CanvasRevisionOut)
async def get_canvas_revision(canvas_id: str, db: Annotated[AsyncSession, Depends(get_db)]) -> CanvasRevisionOut:
    canvas = await _load_canvas(db, canvas_id)
    return CanvasRevisionOut(revision=canvas.revision)


@router.put("/canvas/{canvas_id}", response_model=CanvasOut)
async def replace_canvas(
    canvas_id: str,
    payload: CanvasReplaceRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> CanvasOut:
    canvas = await _load_canvas(db, canvas_id)
    if payload.expected_revision != canvas.revision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": "Revision mismatch", "current_revision": canvas.revision},
        )
    node_count = len(payload.data.get("nodes", [])) if isinstance(payload.data, dict) else 0
    canvas.data = _ensure_lists(deepcopy(payload.data))
    await log_action(db, user.id, "canvas_replaced", {"node_count": node_count, "revision": canvas.revision})
    await _bump_and_broadcast(db, canvas, user, "canvas_replaced", None, None)
    return CanvasOut(revision=canvas.revision, data=_ensure_lists(deepcopy(canvas.data or {})))


@router.post("/canvas/{canvas_id}/nodes", response_model=CanvasRevisionOut, status_code=status.HTTP_201_CREATED)
async def create_node(
    canvas_id: str,
    payload: NodeCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> CanvasRevisionOut:
    canvas = await _load_canvas(db, canvas_id)
    data = _ensure_lists(canvas.data or {})
    node = payload.model_dump()
    if _index_of(data["nodes"], node["id"]) >= 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Node id already exists")
    data["nodes"].append(node)
    canvas.data = data
    rev = await _bump_and_broadcast(db, canvas, user, "node_created", node["id"], node)
    return CanvasRevisionOut(revision=rev)


@router.patch("/canvas/{canvas_id}/nodes/{node_id}", response_model=CanvasRevisionOut)
async def patch_node(
    canvas_id: str,
    node_id: str,
    payload: NodePatchRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> CanvasRevisionOut:
    canvas = await _load_canvas(db, canvas_id)
    data = _ensure_lists(canvas.data or {})
    idx = _index_of(data["nodes"], node_id)
    if idx < 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    patch = payload.model_dump(exclude_unset=True)
    patch.pop("id", None)
    merged = {**data["nodes"][idx], **patch}
    data["nodes"][idx] = merged
    canvas.data = data
    rev = await _bump_and_broadcast(db, canvas, user, "node_updated", node_id, merged)
    return CanvasRevisionOut(revision=rev)


@router.delete("/canvas/{canvas_id}/nodes/{node_id}", response_model=CanvasRevisionOut)
async def delete_node(
    canvas_id: str,
    node_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> CanvasRevisionOut:
    canvas = await _load_canvas(db, canvas_id)
    data = _ensure_lists(canvas.data or {})
    idx = _index_of(data["nodes"], node_id)
    if idx < 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    del data["nodes"][idx]
    data["edges"] = [e for e in data["edges"] if not (isinstance(e, dict) and (e.get("fromNode") == node_id or e.get("toNode") == node_id or e.get("source") == node_id or e.get("target") == node_id))]
    canvas.data = data
    rev = await _bump_and_broadcast(db, canvas, user, "node_deleted", node_id, None)
    return CanvasRevisionOut(revision=rev)


@router.post("/canvas/{canvas_id}/edges", response_model=CanvasRevisionOut, status_code=status.HTTP_201_CREATED)
async def create_edge(
    canvas_id: str,
    payload: EdgeCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> CanvasRevisionOut:
    canvas = await _load_canvas(db, canvas_id)
    data = _ensure_lists(canvas.data or {})
    edge = payload.model_dump()
    if _index_of(data["edges"], edge["id"]) >= 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Edge id already exists")
    data["edges"].append(edge)
    canvas.data = data
    rev = await _bump_and_broadcast(db, canvas, user, "edge_created", edge["id"], edge)
    return CanvasRevisionOut(revision=rev)


@router.patch("/canvas/{canvas_id}/edges/{edge_id}", response_model=CanvasRevisionOut)
async def patch_edge(
    canvas_id: str,
    edge_id: str,
    payload: EdgePatchRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> CanvasRevisionOut:
    canvas = await _load_canvas(db, canvas_id)
    data = _ensure_lists(canvas.data or {})
    idx = _index_of(data["edges"], edge_id)
    if idx < 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Edge not found")
    patch = payload.model_dump(exclude_unset=True)
    patch.pop("id", None)
    merged = {**data["edges"][idx], **patch}
    data["edges"][idx] = merged
    canvas.data = data
    rev = await _bump_and_broadcast(db, canvas, user, "edge_updated", edge_id, merged)
    return CanvasRevisionOut(revision=rev)


@router.delete("/canvas/{canvas_id}/edges/{edge_id}", response_model=CanvasRevisionOut)
async def delete_edge(
    canvas_id: str,
    edge_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> CanvasRevisionOut:
    canvas = await _load_canvas(db, canvas_id)
    data = _ensure_lists(canvas.data or {})
    idx = _index_of(data["edges"], edge_id)
    if idx < 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Edge not found")
    del data["edges"][idx]
    canvas.data = data
    rev = await _bump_and_broadcast(db, canvas, user, "edge_deleted", edge_id, None)
    return CanvasRevisionOut(revision=rev)


async def _resolve_ws_user(token: str | None) -> uuid.UUID | None:
    if not token:
        return None
    try:
        claims = decode_token(token)
    except ValueError:
        return None
    if claims.get("type") != "access":
        return None
    sub = claims.get("sub")
    if not sub:
        return None
    try:
        return uuid.UUID(str(sub))
    except (TypeError, ValueError):
        return None


@router.websocket("/ws/canvas/{canvas_id}")
async def canvas_socket(
    ws: WebSocket,
    canvas_id: str,
    token: Annotated[str | None, Query()] = None,
) -> None:
    factory = get_session_factory()
    async with factory() as db:
        canvas = await db.scalar(select(Canvas).where(Canvas.id == canvas_id))
    if canvas is None:
        await ws.close(code=4404)
        return
    await _resolve_ws_user(token)
    await manager.connect(canvas_id, ws)
    try:
        await ws.send_json({"type": "hello", "revision": canvas.revision})
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(canvas_id, ws)
