"""enforce_single_active_event_per_component

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-11-15 23:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    if 'assessments' in existing_tables:
        existing_indexes = {idx['name'] for idx in inspector.get_indexes('assessments')}
        if 'uq_assessments_component_active_event' not in existing_indexes:
            op.create_index(
                'uq_assessments_component_active_event',
                'assessments',
                ['pattern_component_id'],
                unique=True,
                postgresql_where=sa.text('pattern_component_id IS NOT NULL AND calendar_event_id IS NOT NULL')
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    if 'assessments' in existing_tables:
        existing_indexes = {idx['name'] for idx in inspector.get_indexes('assessments')}
        if 'uq_assessments_component_active_event' in existing_indexes:
            op.drop_index('uq_assessments_component_active_event', table_name='assessments')
