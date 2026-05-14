"""canvas_snapshots table"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _uuid_col() -> sa.types.TypeEngine:
    return postgresql.UUID(as_uuid=True).with_variant(sa.String(36), "sqlite")


def _json_col() -> sa.types.TypeEngine:
    return postgresql.JSONB().with_variant(sa.JSON(), "sqlite")


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def _has_index(table: str, index_name: str) -> bool:
    insp = sa.inspect(op.get_bind())
    if not insp.has_table(table):
        return False
    return any(ix["name"] == index_name for ix in insp.get_indexes(table))


def upgrade() -> None:
    if not _has_table("canvas_snapshots"):
        op.create_table(
            "canvas_snapshots",
            sa.Column("id", _uuid_col(), primary_key=True, nullable=False),
            sa.Column("canvas_id", sa.String(64), nullable=False),
            sa.Column("revision", sa.Integer, nullable=False),
            sa.Column("data", _json_col(), nullable=False),
            sa.Column("comment", sa.String(256), nullable=True),
            sa.Column("created_by_user_id", _uuid_col(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
    if not _has_index("canvas_snapshots", "ix_canvas_snapshots_canvas_id"):
        op.create_index("ix_canvas_snapshots_canvas_id", "canvas_snapshots", ["canvas_id"])
    if not _has_index("canvas_snapshots", "ix_canvas_snapshots_revision"):
        op.create_index("ix_canvas_snapshots_revision", "canvas_snapshots", ["revision"])
    if not _has_index("canvas_snapshots", "ix_canvas_snapshots_created_at"):
        op.create_index("ix_canvas_snapshots_created_at", "canvas_snapshots", ["created_at"])


def downgrade() -> None:
    if _has_index("canvas_snapshots", "ix_canvas_snapshots_created_at"):
        op.drop_index("ix_canvas_snapshots_created_at", table_name="canvas_snapshots")
    if _has_index("canvas_snapshots", "ix_canvas_snapshots_revision"):
        op.drop_index("ix_canvas_snapshots_revision", table_name="canvas_snapshots")
    if _has_index("canvas_snapshots", "ix_canvas_snapshots_canvas_id"):
        op.drop_index("ix_canvas_snapshots_canvas_id", table_name="canvas_snapshots")
    if _has_table("canvas_snapshots"):
        op.drop_table("canvas_snapshots")
