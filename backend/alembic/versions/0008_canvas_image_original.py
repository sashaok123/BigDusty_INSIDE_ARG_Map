"""canvas_images columns for retained original bytes"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return insp.has_table(table)


def _has_column(table: str, column: str) -> bool:
    insp = sa.inspect(op.get_bind())
    if not insp.has_table(table):
        return False
    return any(c["name"] == column for c in insp.get_columns(table))


def upgrade() -> None:
    if not _has_table("canvas_images"):
        return
    if not _has_column("canvas_images", "original_data"):
        op.add_column("canvas_images", sa.Column("original_data", sa.LargeBinary(), nullable=True))
    if not _has_column("canvas_images", "original_size"):
        op.add_column("canvas_images", sa.Column("original_size", sa.Integer(), nullable=True))
    if not _has_column("canvas_images", "original_mime"):
        op.add_column("canvas_images", sa.Column("original_mime", sa.String(length=64), nullable=True))


def downgrade() -> None:
    if not _has_table("canvas_images"):
        return
    if _has_column("canvas_images", "original_mime"):
        op.drop_column("canvas_images", "original_mime")
    if _has_column("canvas_images", "original_size"):
        op.drop_column("canvas_images", "original_size")
    if _has_column("canvas_images", "original_data"):
        op.drop_column("canvas_images", "original_data")
