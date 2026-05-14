"""Password hashing and JWT helpers."""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from .config import get_settings

ALGORITHM = "HS256"
BCRYPT_MAX_BYTES = 72

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)


def _truncate(password: str) -> str:
    encoded = password.encode("utf-8")
    if len(encoded) <= BCRYPT_MAX_BYTES:
        return password
    return encoded[:BCRYPT_MAX_BYTES].decode("utf-8", errors="ignore")


def hash_password(password: str) -> str:
    return _pwd_context.hash(_truncate(password))


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _pwd_context.verify(_truncate(password), password_hash)
    except (ValueError, TypeError):
        return False


def normalize_username(username: str) -> str:
    return username.strip().lower()


def make_jti() -> str:
    return secrets.token_urlsafe(24)


def _encode(claims: dict[str, Any]) -> str:
    settings = get_settings()
    return jwt.encode(claims, settings.jwt_secret, algorithm=ALGORITHM)


def create_access_token(user_id: uuid.UUID, is_admin: bool) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    claims = {
        "sub": str(user_id),
        "type": "access",
        "admin": bool(is_admin),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_access_ttl_min)).timestamp()),
    }
    return _encode(claims)


def create_refresh_token(user_id: uuid.UUID, jti: str) -> tuple[str, datetime]:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=settings.jwt_refresh_ttl_days)
    claims = {
        "sub": str(user_id),
        "type": "refresh",
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return _encode(claims), expires_at


def decode_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise ValueError(str(exc)) from exc
