"""Add target_percentage constraint

Revision ID: ef1efddafb0e
Revises: 9baf8a3c8831
Create Date: 2026-10-04 18:50:13.723583

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ef1efddafb0e'
down_revision: Union[str, Sequence[str], None] = '9baf8a3c8831'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_check_constraint(
        "chk_subject_target_percentage",
        "subjects",
        "target_percentage >= 0 AND target_percentage <= 100"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("chk_subject_target_percentage", "subjects", type_="check")
