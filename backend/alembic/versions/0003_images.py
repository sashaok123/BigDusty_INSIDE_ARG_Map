"""canvas_images table

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-14 18:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _uuid_col() -> sa.types.TypeEngine:
    return postgresql.UUID(as_uuid=True).with_variant(sa.String(36), "sqlite")


def upgrade() -> None:
    op.create_table(
        "canvas_images",
        sa.Column("id", _uuid_col(), primary_key=True, nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("mime", sa.String(64), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by_user_id", _uuid_col(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("sha256", name="uq_canvas_images_sha256"),
    )
    op.create_index("ix_canvas_images_sha256", "canvas_images", ["sha256"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_canvas_images_sha256", table_name="canvas_images")
    op.drop_table("canvas_images")
