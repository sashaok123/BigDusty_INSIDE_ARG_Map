"""Bootstrap initial admin user and canvas content on startup."""

import json
import logging
import secrets
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .models import Canvas, User
from .security import hash_password, normalize_username

logger = logging.getLogger(__name__)

DEFAULT_CANVAS_ID = "main"


async def seed_initial_admin(db: AsyncSession) -> None:
    count = await db.scalar(select(func.count()).select_from(User))
    if count and count > 0:
        return
    settings = get_settings()
    username_display = settings.initial_admin_username.strip() or "admin"
    password = settings.initial_admin_password
    generated = False
    if not password:
        password = secrets.token_urlsafe(18)
        generated = True
    user = User(
        username=normalize_username(username_display),
        username_display=username_display,
        password_hash=hash_password(password),
        is_admin=True,
    )
    db.add(user)
    await db.commit()
    banner = "=" * 72
    note = "auto-generated" if generated else "from INITIAL_ADMIN_PASSWORD env"
    logger.warning(banner)
    logger.warning(
        "INITIAL ADMIN CREATED. username: %s | password: %s (%s). "
        "Change it immediately via POST /auth/change_password.",
        username_display, password, note,
    )
    logger.warning(banner)


async def seed_initial_canvas(db: AsyncSession) -> None:
    existing = await db.scalar(select(func.count()).select_from(Canvas))
    if existing and existing > 0:
        return
    settings = get_settings()
    seed_path: Path = settings.canvas_seed_resolved
    if not seed_path.exists():
        logger.warning("Canvas seed file not found at %s, creating empty canvas", seed_path)
        data: dict = {"nodes": [], "edges": []}
    else:
        try:
            data = json.loads(seed_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            logger.error("Canvas seed at %s is invalid JSON: %s", seed_path, exc)
            data = {"nodes": [], "edges": []}
    if not isinstance(data, dict):
        data = {"nodes": [], "edges": []}
    data.setdefault("nodes", [])
    data.setdefault("edges", [])
    canvas = Canvas(id=DEFAULT_CANVAS_ID, data=data, revision=1, updated_by_user_id=None)
    db.add(canvas)
    await db.commit()
    n_nodes = len(data.get("nodes", []))
    n_edges = len(data.get("edges", []))
    logger.info("Seeded canvas %s with %d nodes / %d edges", DEFAULT_CANVAS_ID, n_nodes, n_edges)
