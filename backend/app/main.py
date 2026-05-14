"""FastAPI application factory and lifespan setup."""

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .database import Base, get_engine, get_session_factory
from .routers import admin, auth, canvas, images
from .seed import seed_initial_admin, seed_initial_canvas

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    engine = get_engine()
    if settings.env != "production":
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    factory = get_session_factory()
    async with factory() as session:
        await seed_initial_admin(session)
        await seed_initial_canvas(session)
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
    )
    settings = get_settings()
    app = FastAPI(title="INSIDE ARG Investigation Map API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
    )
    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(canvas.router)
    app.include_router(images.router)

    @app.get("/health", tags=["health"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
