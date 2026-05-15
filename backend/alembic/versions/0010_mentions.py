"""mentions table"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010"
down_revision: Union[str, None] = "0009"
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
    if not _has_table("mentions"):
        op.create_table(
            "mentions",
            sa.Column("id", _uuid_col(), primary_key=True, nullable=False),
            sa.Column("from_user_id", _uuid_col(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("to_user_id", _uuid_col(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("canvas_id", sa.String(64), nullable=False),
            sa.Column("node_id", sa.String(64), nullable=True),
            sa.Column("text_snippet", sa.String(280), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_index("mentions", "ix_mentions_to_user_id"):
        op.create_index("ix_mentions_to_user_id", "mentions", ["to_user_id"])
    if not _has_index("mentions", "ix_mentions_canvas_id"):
        op.create_index("ix_mentions_canvas_id", "mentions", ["canvas_id"])


def downgrade() -> None:
    if _has_index("mentions", "ix_mentions_canvas_id"):
        op.drop_index("ix_mentions_canvas_id", table_name="mentions")
    if _has_index("mentions", "ix_mentions_to_user_id"):
        op.drop_index("ix_mentions_to_user_id", table_name="mentions")
    if _has_table("mentions"):
        op.drop_table("mentions")
