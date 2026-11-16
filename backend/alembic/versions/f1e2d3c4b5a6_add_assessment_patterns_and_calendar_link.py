"""add_assessment_patterns_and_calendar_link

Revision ID: f1e2d3c4b5a6
Revises: a1b2c3d4e5f6
Create Date: 2026-11-12 21:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1e2d3c4b5a6'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    # 1. Assessment patterns table
    if 'assessment_patterns' not in existing_tables:
        op.create_table(
            'assessment_patterns',
            sa.Column('id', sa.UUID(), nullable=False),
            sa.Column('subject_id', sa.UUID(), nullable=False),
            sa.Column('name', sa.String(), nullable=False),
            sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['subject_id'], ['subjects.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_assessment_patterns_subject_id', 'assessment_patterns', ['subject_id'], unique=False)
        op.create_index(
            'uq_assessment_patterns_subject_active',
            'assessment_patterns',
            ['subject_id'],
            unique=True,
            postgresql_where=sa.text('is_active = true')
        )

    # 2. Assessment pattern components table
    if 'assessment_pattern_components' not in existing_tables:
        op.create_table(
            'assessment_pattern_components',
            sa.Column('id', sa.UUID(), nullable=False),
            sa.Column('pattern_id', sa.UUID(), nullable=False),
            sa.Column('name', sa.String(), nullable=False),
            sa.Column('category', sa.String(), nullable=False),
            sa.Column('max_marks', sa.Numeric(7, 2), nullable=False),
            sa.Column('weightage', sa.Numeric(5, 2), nullable=False),
            sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
            sa.Column('order_index', sa.Integer(), server_default=sa.text('0'), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['pattern_id'], ['assessment_patterns.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.CheckConstraint('max_marks > 0', name='chk_pattern_components_max_marks'),
            sa.CheckConstraint('weightage >= 0 AND weightage <= 100', name='chk_pattern_components_weightage'),
            sa.CheckConstraint(
                "category IN ('internal_test', 'assignment', 'quiz', 'practical', 'viva', 'project', 'midsem', 'endsem', 'other')",
                name='chk_pattern_components_category'
            )
        )
        op.create_index('ix_assessment_pattern_components_pattern_id', 'assessment_pattern_components', ['pattern_id'], unique=False)

    # 3. Extend assessments table
    assessments_cols = {c['name'] for c in inspector.get_columns('assessments')}
    existing_indexes = {idx['name'] for idx in inspector.get_indexes('assessments')}

    if 'calendar_event_id' not in assessments_cols:
        op.add_column('assessments', sa.Column('calendar_event_id', sa.UUID(), nullable=True))
        op.create_foreign_key(
            'fk_assessments_calendar_event_id',
            'assessments',
            'academic_calendar_events',
            ['calendar_event_id'],
            ['id'],
            ondelete='SET NULL'
        )

    if 'pattern_component_id' not in assessments_cols:
        op.add_column('assessments', sa.Column('pattern_component_id', sa.UUID(), nullable=True))
        op.create_foreign_key(
            'fk_assessments_pattern_component_id',
            'assessments',
            'assessment_pattern_components',
            ['pattern_component_id'],
            ['id'],
            ondelete='SET NULL'
        )

    if 'is_auto_generated' not in assessments_cols:
        op.add_column(
            'assessments',
            sa.Column('is_auto_generated', sa.Boolean(), server_default=sa.text('false'), nullable=False)
        )

    if 'ix_assessments_calendar_event_id' not in existing_indexes:
        op.create_index('ix_assessments_calendar_event_id', 'assessments', ['calendar_event_id'], unique=False)

    if 'ix_assessments_pattern_component_id' not in existing_indexes:
        op.create_index('ix_assessments_pattern_component_id', 'assessments', ['pattern_component_id'], unique=False)

    if 'uq_assessments_calendar_event_subject' not in existing_indexes:
        op.create_index(
            'uq_assessments_calendar_event_subject',
            'assessments',
            ['calendar_event_id', 'subject_id'],
            unique=True,
            postgresql_where=sa.text('calendar_event_id IS NOT NULL')
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    if 'assessments' in existing_tables:
        existing_indexes = {idx['name'] for idx in inspector.get_indexes('assessments')}
        assessments_cols = {c['name'] for c in inspector.get_columns('assessments')}
        existing_fks = {fk['name'] for fk in inspector.get_foreign_keys('assessments')}

        if 'uq_assessments_calendar_event_subject' in existing_indexes:
            op.drop_index('uq_assessments_calendar_event_subject', table_name='assessments')
        if 'ix_assessments_pattern_component_id' in existing_indexes:
            op.drop_index('ix_assessments_pattern_component_id', table_name='assessments')
        if 'ix_assessments_calendar_event_id' in existing_indexes:
            op.drop_index('ix_assessments_calendar_event_id', table_name='assessments')

        if 'fk_assessments_pattern_component_id' in existing_fks:
            op.drop_constraint('fk_assessments_pattern_component_id', 'assessments', type_='foreignkey')
        if 'fk_assessments_calendar_event_id' in existing_fks:
            op.drop_constraint('fk_assessments_calendar_event_id', 'assessments', type_='foreignkey')

        if 'is_auto_generated' in assessments_cols:
            op.drop_column('assessments', 'is_auto_generated')
        if 'pattern_component_id' in assessments_cols:
            op.drop_column('assessments', 'pattern_component_id')
        if 'calendar_event_id' in assessments_cols:
            op.drop_column('assessments', 'calendar_event_id')

    if 'assessment_pattern_components' in existing_tables:
        op.drop_table('assessment_pattern_components')

    if 'assessment_patterns' in existing_tables:
        op.drop_table('assessment_patterns')

