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
from ..models import AuditLog, Canvas, Invitation, User
from ..schemas import (
    AuditEntryOut,
    CreateUserRequest,
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
