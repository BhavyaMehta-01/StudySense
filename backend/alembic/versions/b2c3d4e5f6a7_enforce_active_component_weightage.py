"""enforce_active_component_weightage

Revision ID: b2c3d4e5f6a7
Revises: f1e2d3c4b5a6
Create Date: 2026-11-13 11:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'f1e2d3c4b5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    if 'assessment_pattern_components' in existing_tables:
        existing_checks = {
            c['name'] for c in inspector.get_check_constraints('assessment_pattern_components')
        }
        if 'chk_pattern_components_weightage' in existing_checks:
            op.drop_constraint(
                'chk_pattern_components_weightage',
                'assessment_pattern_components',
                type_='check'
            )
        op.create_check_constraint(
            'chk_pattern_components_weightage',
            'assessment_pattern_components',
            'weightage >= 0 AND weightage <= 100 AND (NOT is_active OR weightage > 0)'
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    if 'assessment_pattern_components' in existing_tables:
        existing_checks = {
            c['name'] for c in inspector.get_check_constraints('assessment_pattern_components')
        }
        if 'chk_pattern_components_weightage' in existing_checks:
            op.drop_constraint(
                'chk_pattern_components_weightage',
                'assessment_pattern_components',
                type_='check'
            )
        op.create_check_constraint(
            'chk_pattern_components_weightage',
            'assessment_pattern_components',
            'weightage >= 0 AND weightage <= 100'
        )

