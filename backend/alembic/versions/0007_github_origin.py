"""canvas.github_origin column for GitHub re-sync metadata"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _json_col() -> sa.types.TypeEngine:
    return postgresql.JSONB().with_variant(sa.JSON(), "sqlite")


def _has_column(table: str, column: str) -> bool:
    insp = sa.inspect(op.get_bind())
    if not insp.has_table(table):
        return False
    return any(c["name"] == column for c in insp.get_columns(table))


def upgrade() -> None:
    if not _has_column("canvas", "github_origin"):
        op.add_column("canvas", sa.Column("github_origin", _json_col(), nullable=True))


def downgrade() -> None:
    if _has_column("canvas", "github_origin"):
        op.drop_column("canvas", "github_origin")
