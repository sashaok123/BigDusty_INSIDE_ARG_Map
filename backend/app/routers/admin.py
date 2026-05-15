"""Admin endpoints for managing users and invitations."""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

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
    AuditEntryOut,
    CreateUserRequest,
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
