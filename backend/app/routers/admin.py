"""Admin endpoints for managing users and invitations."""

import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import log_action
from ..config import get_settings
from ..database import get_db
from ..deps import require_admin
from ..github_import import (
    GitHubImportError,
    build_import_plan,
    merge_into_canvas,
    resync_node_blob,
)
from ..models import AuditLog, Canvas, Invitation, User
from ..schemas import (
    ActivityEntryOut,
    AuditEntryOut,
    CreateUserRequest,
    FetchUrlMetaRequest,
    FetchUrlMetaResult,
    GitHubImportPlan,
    GitHubImportRequest,
    GitHubResyncRequest,
    GitHubResyncResult,
    InvitationCreateRequest,
    InvitationOut,
    PatchUserRequest,
    ResetPasswordRequest,
    SnapshotOut,
    SnapshotRestoreOut,
    SnapshotSummary,
    UserOut,
)
from ..security import hash_password, normalize_username
from ..snapshots import get_snapshot as snap_get
from ..snapshots import list_snapshots as snap_list
from ..snapshots import prune_snapshots, write_snapshot
from ..ws import manager as ws_manager

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/users", response_model=list[UserOut])
async def list_users(db: Annotated[AsyncSession, Depends(get_db)]) -> list[UserOut]:
    result = await db.scalars(select(User).order_by(User.created_at))
    return [UserOut.model_validate(u) for u in result.all()]


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: CreateUserRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[User, Depends(require_admin)],
) -> UserOut:
    username_lower = normalize_username(payload.username)
    existing = await db.scalar(select(User).where(User.username == username_lower))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
    user = User(
        username=username_lower,
        username_display=payload.username.strip(),
        password_hash=hash_password(payload.password),
        is_admin=payload.is_admin,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
    await db.refresh(user)
    await log_action(db, actor.id, "user_created", {"target_id": str(user.id), "username": user.username_display, "is_admin": user.is_admin})
    await db.commit()
    return UserOut.model_validate(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[User, Depends(require_admin)],
) -> None:
    if user_id == actor.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await db.delete(user)
    await log_action(db, actor.id, "user_deleted", {"target_id": str(user_id), "username": user.username_display})
    await db.commit()
    return None


@router.post("/users/{user_id}/reset_password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    user_id: uuid.UUID,
    payload: ResetPasswordRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[User, Depends(require_admin)],
) -> None:
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.password_hash = hash_password(payload.new_password)
    await log_action(db, actor.id, "password_reset_by_admin", {"target_id": str(user_id)})
    await db.commit()
    return None


@router.patch("/users/{user_id}", response_model=UserOut)
async def patch_user(
    user_id: uuid.UUID,
    payload: PatchUserRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[User, Depends(require_admin)],
) -> UserOut:
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if payload.is_admin is not None:
        if user_id == actor.id and not payload.is_admin:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot revoke own admin")
        user.is_admin = payload.is_admin
        await log_action(db, actor.id, "user_role_changed", {"target_id": str(user_id), "is_admin": payload.is_admin})
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


def _build_setup_url(token: str) -> str:
    base = get_settings().frontend_base_url
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}invite={token}"


def _invitation_out(inv: Invitation, include_token: bool) -> InvitationOut:
    return InvitationOut(
        id=inv.id,
        username_display=inv.username_display,
        expires_at=inv.expires_at,
        used_at=inv.used_at,
        is_admin_initial=inv.is_admin_initial,
        setup_url=_build_setup_url(inv.token) if include_token else None,
        token=inv.token if include_token else None,
    )


@router.get("/invitations", response_model=list[InvitationOut])
async def list_invitations(db: Annotated[AsyncSession, Depends(get_db)]) -> list[InvitationOut]:
    rows = await db.scalars(select(Invitation).order_by(Invitation.created_at.desc()))
    return [_invitation_out(inv, include_token=False) for inv in rows.all()]


@router.post("/invitations", response_model=InvitationOut, status_code=status.HTTP_201_CREATED)
async def create_invitation(
    payload: InvitationCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[User, Depends(require_admin)],
) -> InvitationOut:
    username_lower = normalize_username(payload.username)
    if not username_lower:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username required")
    existing_user = await db.scalar(select(User).where(User.username == username_lower))
    if existing_user is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
    pending = await db.scalar(
        select(Invitation).where(
            Invitation.username == username_lower, Invitation.used_at.is_(None)
        )
    )
    if pending is not None:
        if pending.expires_at.tzinfo is None:
            exp = pending.expires_at.replace(tzinfo=timezone.utc)
        else:
            exp = pending.expires_at
        if exp >= datetime.now(timezone.utc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Invitation already pending"
            )
    settings = get_settings()
    token = secrets.token_urlsafe(24)
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.invitation_ttl_days)
    inv = Invitation(
        token=token,
        username=username_lower,
        username_display=payload.username.strip(),
        created_by_user_id=actor.id,
        expires_at=expires_at,
        used_at=None,
        is_admin_initial=payload.is_admin,
    )
    db.add(inv)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invitation collision")
    await db.refresh(inv)
    await log_action(db, actor.id, "invitation_created", {"target_username": inv.username_display, "is_admin_initial": inv.is_admin_initial})
    await db.commit()
    return _invitation_out(inv, include_token=True)


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_invitation(
    invitation_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[User, Depends(require_admin)],
) -> None:
    inv = await db.scalar(select(Invitation).where(Invitation.id == invitation_id))
    if inv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")
    await db.delete(inv)
    await log_action(db, actor.id, "invitation_revoked", {"invitation_id": str(invitation_id), "target_username": inv.username_display})
    await db.commit()
    return None


@router.get("/audit", response_model=list[AuditEntryOut])
async def get_audit_log(db: Annotated[AsyncSession, Depends(get_db)]) -> list[AuditEntryOut]:
    result = await db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(200))
    return [AuditEntryOut.model_validate(e) for e in result.all()]


_CANVAS_ACTIONS = {
    "node_created",
    "node_updated",
    "node_deleted",
    "edge_created",
    "edge_updated",
    "edge_deleted",
    "canvas_replaced",
    "canvas_restored",
    "github_import",
    "github_resync_node",
}


@router.get("/canvas/{canvas_id}/activity", response_model=list[ActivityEntryOut])
async def get_canvas_activity(
    canvas_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = 50,
) -> list[ActivityEntryOut]:
    capped = max(1, min(200, limit))
    rows = (await db.scalars(
        select(AuditLog)
        .where(AuditLog.action.in_(_CANVAS_ACTIONS))
        .order_by(AuditLog.created_at.desc())
        .limit(capped * 4)
    )).all()
    filtered: list[AuditLog] = []
    for r in rows:
        pl = r.payload or {}
        if not isinstance(pl, dict):
            continue
        cid = pl.get("canvas_id")
        if cid is None or cid == canvas_id:
            filtered.append(r)
        if len(filtered) >= capped:
            break
    user_ids = {r.user_id for r in filtered if r.user_id is not None}
    user_map: dict[uuid.UUID, str] = {}
    if user_ids:
        users = (await db.scalars(select(User).where(User.id.in_(user_ids)))).all()
        user_map = {u.id: u.username_display for u in users}
    out: list[ActivityEntryOut] = []
    for r in filtered:
        payload = r.payload if isinstance(r.payload, dict) else None
        target_id = payload.get("target_id") if payload else None
        target_label = payload.get("target_label") if payload else None
        out.append(ActivityEntryOut(
            id=r.id,
            user_id=r.user_id,
            username_display=user_map.get(r.user_id) if r.user_id else None,
            action=r.action,
            target_id=target_id if isinstance(target_id, str) else None,
            target_label=target_label if isinstance(target_label, str) else None,
            payload=payload,
            created_at=r.created_at,
        ))
    return out


@router.get("/canvas/{canvas_id}/snapshots", response_model=list[SnapshotSummary])
async def list_canvas_snapshots(
    canvas_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[SnapshotSummary]:
    rows = await snap_list(db, canvas_id)
    return [SnapshotSummary(**r) for r in rows]


@router.get("/canvas/{canvas_id}/snapshots/{snapshot_id}", response_model=SnapshotOut)
async def get_canvas_snapshot(
    canvas_id: str,
    snapshot_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SnapshotOut:
    row = await snap_get(db, canvas_id, snapshot_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
    return SnapshotOut(**row)


@router.post("/canvas/{canvas_id}/snapshots/{snapshot_id}/restore", response_model=SnapshotRestoreOut)
async def restore_canvas_snapshot(
    canvas_id: str,
    snapshot_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[User, Depends(require_admin)],
) -> SnapshotRestoreOut:
    snap = await snap_get(db, canvas_id, snapshot_id)
    if snap is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
    canvas = await db.scalar(select(Canvas).where(Canvas.id == canvas_id))
    if canvas is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Canvas not found")
    from copy import deepcopy
    from sqlalchemy.orm.attributes import flag_modified

    canvas.data = deepcopy(snap["data"] or {})
    canvas.revision = (canvas.revision or 0) + 1
    canvas.updated_by_user_id = actor.id
    flag_modified(canvas, "data")
    await write_snapshot(db, canvas, actor, f"canvas_restored:{snap['revision']}")
    await prune_snapshots(db, canvas.id)
    await log_action(db, actor.id, "canvas_restored", {
        "source_snapshot_id": str(snapshot_id),
        "source_revision": snap["revision"],
        "new_revision": canvas.revision,
    })
    await db.commit()
    await db.refresh(canvas)
    await ws_manager.broadcast(
        canvas.id,
        {
            "type": "revision",
            "revision": canvas.revision,
            "change": {"kind": "canvas_replaced", "id": None, "data": None},
            "by": actor.username_display,
        },
    )
    return SnapshotRestoreOut(
        revision=canvas.revision,
        data=canvas.data or {},
        snapshot_id=snap["id"],
    )


@router.post("/import/github", response_model=GitHubImportPlan)
async def import_from_github(
    payload: GitHubImportRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[User, Depends(require_admin)],
) -> GitHubImportPlan:
    canvas = await db.scalar(select(Canvas).where(Canvas.id == payload.canvas_id))
    if canvas is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Canvas not found")
    try:
        nodes_to_create, groups_to_create, skipped = await build_import_plan(
            db=db,
            user_id=actor.id,
            canvas_id=payload.canvas_id,
            owner=payload.owner,
            repo=payload.repo,
            branch=payload.branch or "main",
            path_prefix=payload.path_prefix or "",
            token=payload.token,
            parse_frontmatter=payload.parse_frontmatter,
            folder_layout=payload.folder_layout,
        )
    except GitHubImportError as exc:
        await db.rollback()
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc
    files_planned = len(nodes_to_create)
    preview = [
        {
            "id": n.get("id"),
            "label": n.get("label") or n.get("slug") or n.get("id"),
            "kind": n.get("kind"),
            "github_path": n.get("github_path"),
        }
        for n in nodes_to_create[:50]
    ]
    if payload.dry_run:
        await db.rollback()
        return GitHubImportPlan(
            files_total=files_planned + len(skipped),
            files_planned=files_planned,
            nodes_planned=files_planned,
            groups_planned=len(groups_to_create),
            skipped=skipped,
            nodes_preview=preview,
            revision=None,
        )
    merged = merge_into_canvas(canvas.data or {}, nodes_to_create, groups_to_create)
    canvas.data = merged
    canvas.github_origin = {
        "owner": payload.owner,
        "repo": payload.repo,
        "branch": payload.branch or "main",
        "path_prefix": payload.path_prefix or "",
    }
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(canvas, "data")
    flag_modified(canvas, "github_origin")
    canvas.revision = (canvas.revision or 0) + 1
    canvas.updated_by_user_id = actor.id
    await write_snapshot(db, canvas, actor, f"github_import:{payload.owner}/{payload.repo}")
    await prune_snapshots(db, canvas.id)
    await log_action(db, actor.id, "github_import", {
        "owner": payload.owner,
        "repo": payload.repo,
        "branch": payload.branch or "main",
        "nodes_added": files_planned,
        "groups_added": len(groups_to_create),
        "skipped_count": len(skipped),
    })
    await db.commit()
    await db.refresh(canvas)
    await ws_manager.broadcast(
        canvas.id,
        {
            "type": "revision",
            "revision": canvas.revision,
            "change": {"kind": "canvas_replaced", "id": None, "data": None},
            "by": actor.username_display,
        },
    )
    return GitHubImportPlan(
        files_total=files_planned + len(skipped),
        files_planned=files_planned,
        nodes_planned=files_planned,
        groups_planned=len(groups_to_create),
        skipped=skipped,
        nodes_preview=preview,
        revision=canvas.revision,
    )


@router.post("/canvas/{canvas_id}/resync_node", response_model=GitHubResyncResult)
async def resync_node_from_github(
    canvas_id: str,
    payload: GitHubResyncRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    actor: Annotated[User, Depends(require_admin)],
) -> GitHubResyncResult:
    canvas = await db.scalar(select(Canvas).where(Canvas.id == canvas_id))
    if canvas is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Canvas not found")
    origin = getattr(canvas, "github_origin", None) or {}
    if not origin or not origin.get("owner") or not origin.get("repo"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Canvas has no github_origin")
    data = canvas.data or {}
    nodes = data.get("nodes") if isinstance(data, dict) else []
    if not isinstance(nodes, list):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No nodes")
    target_idx = -1
    target = None
    for idx, n in enumerate(nodes):
        if isinstance(n, dict) and n.get("id") == payload.node_id:
            target_idx = idx
            target = n
            break
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    if not target.get("github_path"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Node has no github_path")
    try:
        updated = await resync_node_blob(
            db=db,
            user_id=actor.id,
            canvas_id=canvas_id,
            owner=origin["owner"],
            repo=origin["repo"],
            branch=origin.get("branch") or "main",
            token=None,
            node=target,
        )
    except GitHubImportError as exc:
        await db.rollback()
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc
    nodes[target_idx] = updated
    canvas.data = data
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(canvas, "data")
    canvas.revision = (canvas.revision or 0) + 1
    canvas.updated_by_user_id = actor.id
    await write_snapshot(db, canvas, actor, f"resync_node:{payload.node_id}")
    await prune_snapshots(db, canvas.id)
    await log_action(db, actor.id, "github_resync_node", {
        "node_id": payload.node_id,
        "owner": origin["owner"],
        "repo": origin["repo"],
    })
    await db.commit()
    await db.refresh(canvas)
    await ws_manager.broadcast(
        canvas_id,
        {
            "type": "revision",
            "revision": canvas.revision,
            "change": {"kind": "node_updated", "id": payload.node_id, "data": updated},
            "by": actor.username_display,
        },
    )
    return GitHubResyncResult(revision=canvas.revision, data=updated)


_HTML_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_META_RE = re.compile(
    r"<meta\s+([^>]*?)/?>",
    re.IGNORECASE | re.DOTALL,
)
_ATTR_RE = re.compile(
    r'([A-Za-z:_-]+)\s*=\s*("([^"]*)"|\'([^\']*)\'|([^\s>]+))',
    re.IGNORECASE,
)

_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _unescape_html_entities(s: str) -> str:
    if not s:
        return s
    s = (
        s.replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
    )
    return s.strip()


def _parse_meta_attrs(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in _ATTR_RE.finditer(raw):
        key = m.group(1).lower()
        value = m.group(3) or m.group(4) or m.group(5) or ""
        out[key] = value
    return out


def _extract_html_meta(html: str) -> dict[str, str | None]:
    title_m = _HTML_TITLE_RE.search(html)
    title = _unescape_html_entities(re.sub(r"\s+", " ", title_m.group(1))) if title_m else None
    og_title = None
    og_image = None
    og_description = None
    description = None
    for m in _META_RE.finditer(html):
        attrs = _parse_meta_attrs(m.group(1))
        name = (attrs.get("name") or "").lower()
        prop = (attrs.get("property") or "").lower()
        content = attrs.get("content")
        if not content:
            continue
        content = _unescape_html_entities(content)
        if prop == "og:title" and not og_title:
            og_title = content
        elif prop == "og:image" and not og_image:
            og_image = content
        elif prop == "og:description" and not og_description:
            og_description = content
        elif name == "description" and not description:
            description = content
        elif name == "twitter:description" and not description:
            description = content
        elif name == "twitter:image" and not og_image:
            og_image = content
    return {
        "title": og_title or title or None,
        "description": og_description or description or None,
        "image_url": og_image or None,
    }


@router.post("/fetch_url_meta", response_model=FetchUrlMetaResult)
async def fetch_url_meta(payload: FetchUrlMetaRequest) -> FetchUrlMetaResult:
    raw_url = (payload.url or "").strip()
    if not raw_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty URL")
    if not raw_url.startswith(("http://", "https://")):
        raw_url = "https://" + raw_url
    parsed = urlparse(raw_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid URL")
    now = datetime.now(timezone.utc).isoformat()
    try:
        async with httpx.AsyncClient(
            headers={
                "User-Agent": _BROWSER_UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
            follow_redirects=True,
            timeout=8.0,
        ) as client:
            resp = await client.get(raw_url)
    except (httpx.HTTPError, OSError) as exc:
        return FetchUrlMetaResult(
            url=raw_url,
            title=None,
            description=None,
            image_url=None,
            fetched_at=now,
            status="failed",
            error=str(exc)[:200],
        )
    if resp.status_code >= 400:
        return FetchUrlMetaResult(
            url=raw_url,
            title=None,
            description=None,
            image_url=None,
            fetched_at=now,
            status="failed",
            error=f"http_{resp.status_code}",
        )
    content_type = (resp.headers.get("content-type") or "").lower()
    if "html" not in content_type and "xml" not in content_type:
        return FetchUrlMetaResult(
            url=str(resp.url),
            title=None,
            description=None,
            image_url=None,
            fetched_at=now,
            status="ok",
        )
    body = resp.text[:262144]
    meta = _extract_html_meta(body)
    image_url = meta.get("image_url")
    if image_url:
        try:
            image_url = urljoin(str(resp.url), image_url)
        except ValueError:
            image_url = None
    return FetchUrlMetaResult(
        url=str(resp.url),
        title=meta.get("title"),
        description=meta.get("description"),
        image_url=image_url,
        fetched_at=now,
        status="ok",
    )
