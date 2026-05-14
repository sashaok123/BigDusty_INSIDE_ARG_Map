"""Authentication endpoints: login, refresh, logout, change password, whoami,
invitation check and setup."""

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_current_user
from ..models import Invitation, RefreshToken, User
from ..schemas import (
    AccessToken,
    ChangePasswordRequest,
    InvitationCheckOut,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    SetupAccountRequest,
    TokenPair,
    UserOut,
)
from ..security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    make_jti,
    normalize_username,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenPair)
async def login(payload: LoginRequest, db: Annotated[AsyncSession, Depends(get_db)]) -> TokenPair:
    user = await db.scalar(select(User).where(User.username == normalize_username(payload.username)))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    access = create_access_token(user.id, user.is_admin)
    jti = make_jti()
    refresh, exp_at = create_refresh_token(user.id, jti)
    db.add(RefreshToken(jti=jti, user_id=user.id, expires_at=exp_at, revoked=False))
    await db.commit()
    return TokenPair(access_token=access, refresh_token=refresh, user=UserOut.model_validate(user))


@router.post("/refresh", response_model=AccessToken)
async def refresh_token(payload: RefreshRequest, db: Annotated[AsyncSession, Depends(get_db)]) -> AccessToken:
    try:
        claims = decode_token(payload.refresh_token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid refresh token: {exc}")
    if claims.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not a refresh token")
    jti = claims.get("jti")
    sub = claims.get("sub")
    if not jti or not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing fields")
    record = await db.scalar(select(RefreshToken).where(RefreshToken.jti == jti))
    if record is None or record.revoked:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token revoked")
    exp_at = record.expires_at
    if exp_at.tzinfo is None:
        exp_at = exp_at.replace(tzinfo=timezone.utc)
    if exp_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired")
    try:
        user_id = uuid.UUID(str(sub))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid subject")
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return AccessToken(access_token=create_access_token(user.id, user.is_admin))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: LogoutRequest, db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    try:
        claims = decode_token(payload.refresh_token)
    except ValueError:
        return None
    jti = claims.get("jti")
    if not jti:
        return None
    record = await db.scalar(select(RefreshToken).where(RefreshToken.jti == jti))
    if record is None:
        return None
    record.revoked = True
    await db.commit()
    return None


@router.post("/change_password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: ChangePasswordRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Old password incorrect")
    user.password_hash = hash_password(payload.new_password)
    await db.commit()
    return None


@router.get("/me", response_model=UserOut)
async def whoami(user: Annotated[User, Depends(get_current_user)]) -> UserOut:
    return UserOut.model_validate(user)


def _normalize_expires(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


@router.get("/invitation/{token}", response_model=InvitationCheckOut)
async def check_invitation(
    token: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> InvitationCheckOut:
    inv = await db.scalar(select(Invitation).where(Invitation.token == token))
    if inv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")
    if inv.used_at is not None:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Invitation already used")
    if _normalize_expires(inv.expires_at) < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Invitation expired")
    return InvitationCheckOut(
        valid=True,
        username=inv.username_display,
        expires_at=inv.expires_at,
        is_admin_initial=inv.is_admin_initial,
    )


@router.post("/setup", response_model=TokenPair)
async def setup_account(
    payload: SetupAccountRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TokenPair:
    inv = await db.scalar(select(Invitation).where(Invitation.token == payload.token))
    if inv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")
    if inv.used_at is not None:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Invitation already used")
    if _normalize_expires(inv.expires_at) < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Invitation expired")
    existing = await db.scalar(select(User).where(User.username == inv.username))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
    user = User(
        username=inv.username,
        username_display=inv.username_display,
        password_hash=hash_password(payload.password),
        is_admin=inv.is_admin_initial,
    )
    db.add(user)
    inv.used_at = datetime.now(timezone.utc)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
    await db.refresh(user)
    access = create_access_token(user.id, user.is_admin)
    jti = make_jti()
    refresh, exp_at = create_refresh_token(user.id, jti)
    db.add(RefreshToken(jti=jti, user_id=user.id, expires_at=exp_at, revoked=False))
    await db.commit()
    return TokenPair(access_token=access, refresh_token=refresh, user=UserOut.model_validate(user))
