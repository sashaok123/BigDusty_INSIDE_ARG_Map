"""audit_log table

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-14 19:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _uuid_col() -> sa.types.TypeEngine:
    return postgresql.UUID(as_uuid=True).with_variant(sa.String(36), "sqlite")


def _json_col() -> sa.types.TypeEngine:
    return postgresql.JSONB().with_variant(sa.JSON(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", _uuid_col(), primary_key=True, nullable=False),
        sa.Column("user_id", _uuid_col(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(64), nullable=False, index=True),
        sa.Column("payload", _json_col(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), index=True),
    )
    op.create_index("ix_audit_log_action", "audit_log", ["action"])
    op.create_index("ix_audit_log_created_at", "audit_log", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_audit_log_created_at", table_name="audit_log")
    op.drop_index("ix_audit_log_action", table_name="audit_log")
    op.drop_table("audit_log")
