"""Pydantic settings loaded from environment variables."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    database_url: str = Field(..., alias="DATABASE_URL")
    jwt_secret: str = Field(..., alias="JWT_SECRET", min_length=32)
    jwt_access_ttl_min: int = Field(default=30, alias="JWT_ACCESS_TTL_MIN")
    jwt_refresh_ttl_days: int = Field(default=7, alias="JWT_REFRESH_TTL_DAYS")
    initial_admin_username: str = Field(default="admin", alias="INITIAL_ADMIN_USERNAME")
    initial_admin_password: str | None = Field(default=None, alias="INITIAL_ADMIN_PASSWORD")
    allowed_origins: str = Field(
        default="https://sashaok123.github.io,http://localhost:8000",
        alias="ALLOWED_ORIGINS",
    )
    canvas_seed_path: str = Field(default="seed/canvas.canvas", alias="CANVAS_SEED_PATH")
    env: str = Field(default="production", alias="ENV")

    @field_validator("database_url")
    @classmethod
    def normalize_db_url(cls, v: str) -> str:
        if v.startswith("postgres://"):
            return "postgresql+asyncpg://" + v[len("postgres://"):]
        if v.startswith("postgresql://") and "+asyncpg" not in v:
            return "postgresql+asyncpg://" + v[len("postgresql://"):]
        return v

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def canvas_seed_resolved(self) -> Path:
        p = Path(self.canvas_seed_path)
        if p.is_absolute():
            return p
        return (Path(__file__).resolve().parent.parent / p).resolve()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
