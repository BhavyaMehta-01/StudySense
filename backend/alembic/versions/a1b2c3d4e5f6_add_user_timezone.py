"""add_user_timezone

Revision ID: a1b2c3d4e5f6
Revises: 848e8e6275a3
Create Date: 2026-11-11 20:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '848e8e6275a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    user_cols = {c['name'] for c in inspector.get_columns('users')}
    if 'timezone' not in user_cols:
        op.add_column(
            'users',
            sa.Column('timezone', sa.String(), nullable=False, server_default=sa.text("'UTC'"))
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    user_cols = {c['name'] for c in inspector.get_columns('users')}
    if 'timezone' in user_cols:
        op.drop_column('users', 'timezone')

