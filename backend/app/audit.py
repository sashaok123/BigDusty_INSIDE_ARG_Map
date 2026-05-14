"""Audit log writer. All sensitive admin and auth actions get a row here."""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from .models import AuditLog


async def log_action(
    db: AsyncSession,
    user_id: uuid.UUID | None,
    action: str,
    payload: dict[str, Any] | None = None,
) -> AuditLog:
    entry = AuditLog(user_id=user_id, action=action, payload=payload or None)
    db.add(entry)
    return entry
