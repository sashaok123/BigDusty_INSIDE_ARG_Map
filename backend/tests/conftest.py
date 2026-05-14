"""Test fixtures: in-memory sqlite engine, seeded admin, AsyncClient."""

import asyncio
import os
import sys
from pathlib import Path

import pytest
import pytest_asyncio

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))


SEED_ADMIN_USER = "admin"
SEED_ADMIN_PASSWORD = "smoke-test-password-123"


def _configure_env() -> None:
    os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
    os.environ["JWT_SECRET"] = "test-jwt-secret-which-is-long-enough-for-validation-please"
    os.environ["INITIAL_ADMIN_USERNAME"] = SEED_ADMIN_USER
    os.environ["INITIAL_ADMIN_PASSWORD"] = SEED_ADMIN_PASSWORD
    os.environ["ENV"] = "development"
    os.environ["CANVAS_SEED_PATH"] = str(BACKEND_DIR.parent / "data" / "canvas.canvas")
    os.environ["ALLOWED_ORIGINS"] = "http://localhost:8000"


_configure_env()


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session")
async def app_instance():
    from app.config import get_settings
    from app.database import Base, get_engine, reset_engine, get_session_factory
    from app.main import create_app
    from app.seed import seed_initial_admin, seed_initial_canvas

    get_settings.cache_clear()
    await reset_engine()
    application = create_app()
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = get_session_factory()
    async with factory() as session:
        await seed_initial_admin(session)
        await seed_initial_canvas(session)
    yield application
    await reset_engine()


@pytest_asyncio.fixture()
async def client(app_instance):
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=app_instance)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture()
async def admin_token(client):
    resp = await client.post(
        "/auth/login",
        json={"username": SEED_ADMIN_USER, "password": SEED_ADMIN_PASSWORD},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return body["access_token"]
