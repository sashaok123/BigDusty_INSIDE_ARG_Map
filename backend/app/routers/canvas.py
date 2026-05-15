"""Canvas REST endpoints and the WebSocket broadcast channel."""

import uuid
from copy import deepcopy
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import log_action
from ..database import get_db, get_session_factory
from ..deps import get_current_user
from ..models import Canvas, Mention, User
from ..security import normalize_username
from ..snapshots import prune_snapshots, write_snapshot
from ..schemas import (
    CanvasOut,
    CanvasReplaceRequest,
    CanvasRevisionOut,
    EdgeCreateRequest,
    EdgePatchRequest,
    MentionCreateRequest,
    MentionCreateResponse,
    MentionOut,
    NodeCreateRequest,
    NodePatchRequest,
    PublicUserOut,
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


def _resolve_label(item_data: dict | None, fallback_id: str | None) -> str | None:
    if isinstance(item_data, dict):
        for key in ("label", "title", "slug", "name"):
            val = item_data.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()[:128]
    return fallback_id


async def _bump_and_broadcast(
    db: AsyncSession,
    canvas: Canvas,
    user: User,
    kind: str,
    item_id: str | None,
    item_data: dict | None,
    client_id: str | None = None,
) -> int:
    canvas.revision = (canvas.revision or 0) + 1
    canvas.updated_by_user_id = user.id
    _mark_dirty(canvas)
    await write_snapshot(db, canvas, user, kind)
    await prune_snapshots(db, canvas.id)
    target_label = _resolve_label(item_data, item_id)
    audit_payload = {
        "canvas_id": canvas.id,
        "target_id": item_id,
        "target_label": target_label,
    }
    await log_action(db, user.id, kind, audit_payload)
    await db.commit()
    await db.refresh(canvas)
    change: dict[str, object] = {"kind": kind, "id": item_id, "data": item_data}
    if client_id:
        change["clientId"] = client_id
    await manager.broadcast(
        canvas.id,
        {
            "type": "revision",
            "revision": canvas.revision,
            "change": change,
            "by": user.username_display,
        },
    )
    await manager.broadcast(
        canvas.id,
        {
            "type": "audit_log",
            "entry": {
                "action": kind,
                "target_id": item_id,
                "target_label": target_label,
                "username_display": user.username_display,
                "user_id": str(user.id),
            },
        },
    )
    return canvas.revision


@router.get("/canvas/{canvas_id}", response_model=CanvasOut)
async def get_canvas(canvas_id: str, db: Annotated[AsyncSession, Depends(get_db)]) -> CanvasOut:
    canvas = await _load_canvas(db, canvas_id)
    origin = deepcopy(canvas.github_origin) if getattr(canvas, "github_origin", None) else None
    return CanvasOut(revision=canvas.revision, data=_ensure_lists(deepcopy(canvas.data or {})), github_origin=origin)


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
    x_client_id: Annotated[str | None, Header(alias="X-Client-Id")] = None,
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
    await _bump_and_broadcast(db, canvas, user, "canvas_replaced", None, None, x_client_id)
    origin = deepcopy(canvas.github_origin) if getattr(canvas, "github_origin", None) else None
    return CanvasOut(revision=canvas.revision, data=_ensure_lists(deepcopy(canvas.data or {})), github_origin=origin)


@router.post("/canvas/{canvas_id}/nodes", response_model=CanvasRevisionOut, status_code=status.HTTP_201_CREATED)
async def create_node(
    canvas_id: str,
    payload: NodeCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    x_client_id: Annotated[str | None, Header(alias="X-Client-Id")] = None,
) -> CanvasRevisionOut:
    canvas = await _load_canvas(db, canvas_id)
    data = _ensure_lists(canvas.data or {})
    node = payload.model_dump()
    if _index_of(data["nodes"], node["id"]) >= 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Node id already exists")
    data["nodes"].append(node)
    canvas.data = data
    rev = await _bump_and_broadcast(db, canvas, user, "node_created", node["id"], node, x_client_id)
    return CanvasRevisionOut(revision=rev)


@router.patch("/canvas/{canvas_id}/nodes/{node_id}", response_model=CanvasRevisionOut)
async def patch_node(
    canvas_id: str,
    node_id: str,
    payload: NodePatchRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    x_client_id: Annotated[str | None, Header(alias="X-Client-Id")] = None,
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
    rev = await _bump_and_broadcast(db, canvas, user, "node_updated", node_id, merged, x_client_id)
    return CanvasRevisionOut(revision=rev)


@router.delete("/canvas/{canvas_id}/nodes/{node_id}", response_model=CanvasRevisionOut)
async def delete_node(
    canvas_id: str,
    node_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    x_client_id: Annotated[str | None, Header(alias="X-Client-Id")] = None,
) -> CanvasRevisionOut:
    canvas = await _load_canvas(db, canvas_id)
    data = _ensure_lists(canvas.data or {})
    idx = _index_of(data["nodes"], node_id)
    if idx < 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    del data["nodes"][idx]
    data["edges"] = [e for e in data["edges"] if not (isinstance(e, dict) and (e.get("fromNode") == node_id or e.get("toNode") == node_id or e.get("source") == node_id or e.get("target") == node_id))]
    canvas.data = data
    rev = await _bump_and_broadcast(db, canvas, user, "node_deleted", node_id, None, x_client_id)
    return CanvasRevisionOut(revision=rev)


@router.post("/canvas/{canvas_id}/edges", response_model=CanvasRevisionOut, status_code=status.HTTP_201_CREATED)
async def create_edge(
    canvas_id: str,
    payload: EdgeCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    x_client_id: Annotated[str | None, Header(alias="X-Client-Id")] = None,
) -> CanvasRevisionOut:
    canvas = await _load_canvas(db, canvas_id)
    data = _ensure_lists(canvas.data or {})
    edge = payload.model_dump()
    if _index_of(data["edges"], edge["id"]) >= 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Edge id already exists")
    data["edges"].append(edge)
    canvas.data = data
    rev = await _bump_and_broadcast(db, canvas, user, "edge_created", edge["id"], edge, x_client_id)
    return CanvasRevisionOut(revision=rev)


@router.patch("/canvas/{canvas_id}/edges/{edge_id}", response_model=CanvasRevisionOut)
async def patch_edge(
    canvas_id: str,
    edge_id: str,
    payload: EdgePatchRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    x_client_id: Annotated[str | None, Header(alias="X-Client-Id")] = None,
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
    rev = await _bump_and_broadcast(db, canvas, user, "edge_updated", edge_id, merged, x_client_id)
    return CanvasRevisionOut(revision=rev)


@router.delete("/canvas/{canvas_id}/edges/{edge_id}", response_model=CanvasRevisionOut)
async def delete_edge(
    canvas_id: str,
    edge_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    x_client_id: Annotated[str | None, Header(alias="X-Client-Id")] = None,
) -> CanvasRevisionOut:
    canvas = await _load_canvas(db, canvas_id)
    data = _ensure_lists(canvas.data or {})
    idx = _index_of(data["edges"], edge_id)
    if idx < 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Edge not found")
    del data["edges"][idx]
    canvas.data = data
    rev = await _bump_and_broadcast(db, canvas, user, "edge_deleted", edge_id, None, x_client_id)
    return CanvasRevisionOut(revision=rev)


@router.post(
    "/canvas/{canvas_id}/mentions",
    response_model=MentionCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_mention(
    canvas_id: str,
    payload: MentionCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> MentionCreateResponse:
    target_lower = normalize_username(payload.to_username)
    if not target_lower:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty username")
    target = await db.scalar(select(User).where(User.username == target_lower))
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    row = Mention(
        from_user_id=user.id,
        to_user_id=target.id,
        canvas_id=canvas_id,
        node_id=payload.node_id,
        text_snippet=payload.text_snippet[:280],
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return MentionCreateResponse(id=row.id)


@router.get(
    "/canvas/{canvas_id}/mentions/unread",
    response_model=list[MentionOut],
)
async def list_unread_mentions(
    canvas_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[MentionOut]:
    rows = (await db.scalars(
        select(Mention)
        .where(
            Mention.to_user_id == user.id,
            Mention.canvas_id == canvas_id,
            Mention.read_at.is_(None),
        )
        .order_by(Mention.created_at.desc())
        .limit(100)
    )).all()
    from_ids = {r.from_user_id for r in rows}
    user_map: dict[uuid.UUID, str] = {}
    if from_ids:
        users = (await db.scalars(select(User).where(User.id.in_(from_ids)))).all()
        user_map = {u.id: u.username_display for u in users}
    return [
        MentionOut(
            id=r.id,
            canvas_id=r.canvas_id,
            from_user_id=r.from_user_id,
            from_username=user_map.get(r.from_user_id),
            to_user_id=r.to_user_id,
            node_id=r.node_id,
            text_snippet=r.text_snippet,
            created_at=r.created_at,
            read_at=r.read_at,
        )
        for r in rows
    ]


@router.post(
    "/canvas/{canvas_id}/mentions/{mention_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def mark_mention_read(
    canvas_id: str,
    mention_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    row = await db.scalar(
        select(Mention).where(
            Mention.id == mention_id,
            Mention.canvas_id == canvas_id,
            Mention.to_user_id == user.id,
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mention not found")
    if row.read_at is None:
        row.read_at = datetime.now(timezone.utc)
        await db.commit()
    return None


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
    import json as _json

    factory = get_session_factory()
    revision = 0
    authed_username: str | None = None
    async with factory() as db:
        canvas = await db.scalar(select(Canvas).where(Canvas.id == canvas_id))
        if canvas is None:
            await ws.close(code=4404)
            return
        revision = canvas.revision
        user_id = await _resolve_ws_user(token)
        if user_id is not None:
            user = await db.scalar(select(User).where(User.id == user_id))
            if user is not None:
                authed_username = user.username_display or user.username
    await manager.connect(canvas_id, ws)
    try:
        await ws.send_json({"type": "hello", "revision": revision})
        await ws.send_json({"type": "presence", "users": manager.presence_users(canvas_id)})
        for snap in manager.snapshot_locks(canvas_id):
            await ws.send_json({
                "type": "node_locked",
                "node_id": snap.get("node_id"),
                "username": snap.get("username"),
                "client_id": snap.get("client_id"),
            })
        while True:
            raw = await ws.receive_text()
            try:
                payload = _json.loads(raw)
            except (ValueError, TypeError):
                continue
            if not isinstance(payload, dict):
                continue
            ptype = payload.get("type")
            if ptype == "presence_hello":
                cid = payload.get("client_id")
                if not isinstance(cid, str) or not cid:
                    continue
                uname = authed_username if authed_username else "anonymous"
                await manager.register_presence(canvas_id, ws, cid, uname)
            elif ptype == "node_locked":
                node_id = payload.get("node_id")
                client_id = payload.get("client_id")
                if not isinstance(node_id, str) or not isinstance(client_id, str):
                    continue
                uname = payload.get("username") or authed_username or "anonymous"
                await manager.register_node_lock(canvas_id, node_id, client_id, uname, exclude_ws=ws)
            elif ptype == "node_unlocked":
                node_id = payload.get("node_id")
                client_id = payload.get("client_id")
                if not isinstance(node_id, str) or not isinstance(client_id, str):
                    continue
                await manager.release_node_lock(canvas_id, node_id, client_id, exclude_ws=ws)
            elif ptype == "node_lock_heartbeat":
                node_id = payload.get("node_id")
                client_id = payload.get("client_id")
                if not isinstance(node_id, str) or not isinstance(client_id, str):
                    continue
                await manager.refresh_node_lock(canvas_id, node_id, client_id)
            elif ptype == "cursor_move":
                cid = payload.get("client_id")
                if not isinstance(cid, str) or not cid:
                    continue
                xi = payload.get("x_image")
                yi = payload.get("y_image")
                if not isinstance(xi, (int, float)) or not isinstance(yi, (int, float)):
                    continue
                uname = authed_username if authed_username else "anonymous"
                await manager.broadcast(
                    canvas_id,
                    {
                        "type": "cursor_move",
                        "client_id": cid,
                        "username": uname,
                        "x_image": float(xi),
                        "y_image": float(yi),
                    },
                    exclude_ws=ws,
                )
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(canvas_id, ws)
