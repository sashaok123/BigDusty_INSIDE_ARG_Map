"""canvas_share_links table"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _uuid_col() -> sa.types.TypeEngine:
    return postgresql.UUID(as_uuid=True).with_variant(sa.String(36), "sqlite")


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def _has_index(table: str, index_name: str) -> bool:
    insp = sa.inspect(op.get_bind())
    if not insp.has_table(table):
        return False
    return any(ix["name"] == index_name for ix in insp.get_indexes(table))


def upgrade() -> None:
    if not _has_table("canvas_share_links"):
        op.create_table(
            "canvas_share_links",
            sa.Column("token", sa.String(64), primary_key=True, nullable=False),
            sa.Column("canvas_id", sa.String(64), sa.ForeignKey("canvas.id", ondelete="CASCADE"), nullable=False),
            sa.Column("created_by_user_id", _uuid_col(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_index("canvas_share_links", "ix_canvas_share_links_canvas_id"):
        op.create_index("ix_canvas_share_links_canvas_id", "canvas_share_links", ["canvas_id"])


def downgrade() -> None:
    if _has_index("canvas_share_links", "ix_canvas_share_links_canvas_id"):
        op.drop_index("ix_canvas_share_links_canvas_id", table_name="canvas_share_links")
    if _has_table("canvas_share_links"):
        op.drop_table("canvas_share_links")
