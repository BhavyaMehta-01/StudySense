"""add_timetable_attendance_models

Revision ID: 848e8e6275a3
Revises: de343d8b344e
Create Date: 2026-11-11 19:42:30.736814

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '848e8e6275a3'
down_revision: Union[str, Sequence[str], None] = 'de343d8b344e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema safely and idempotently."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    # 1. Semester dates (nullable for backward compatibility)
    semesters_cols = {c['name'] for c in inspector.get_columns('semesters')}
    if 'start_date' not in semesters_cols:
        op.add_column('semesters', sa.Column('start_date', sa.Date(), nullable=True))
    if 'end_date' not in semesters_cols:
        op.add_column('semesters', sa.Column('end_date', sa.Date(), nullable=True))
        op.create_check_constraint(
            'chk_semesters_date_order',
            'semesters',
            'start_date IS NULL OR end_date IS NULL OR start_date <= end_date'
        )

    # 2. Subject attendance target (defaults to 75%, separate from grade target_percentage)
    subjects_cols = {c['name'] for c in inspector.get_columns('subjects')}
    if 'attendance_target_percentage' not in subjects_cols:
        op.add_column('subjects', sa.Column('attendance_target_percentage', sa.Integer(), nullable=False, server_default=sa.text('75')))
        op.create_check_constraint(
            'chk_subject_attendance_target_percentage',
            'subjects',
            'attendance_target_percentage >= 0 AND attendance_target_percentage <= 100'
        )

    # 3. Timetable slots
    if 'timetable_slots' not in existing_tables:
        op.create_table(
            'timetable_slots',
            sa.Column('id', sa.UUID(), nullable=False),
            sa.Column('semester_id', sa.UUID(), nullable=False),
            sa.Column('subject_id', sa.UUID(), nullable=False),
            sa.Column('day_of_week', sa.Integer(), nullable=False),
            sa.Column('start_time', sa.Time(), nullable=False),
            sa.Column('end_time', sa.Time(), nullable=False),
            sa.Column('effective_from', sa.Date(), nullable=False),
            sa.Column('effective_to', sa.Date(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['semester_id'], ['semesters.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['subject_id'], ['subjects.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.CheckConstraint('day_of_week >= 0 AND day_of_week <= 6', name='chk_timetable_slots_day_of_week'),
            sa.CheckConstraint('start_time < end_time', name='chk_timetable_slots_time_order'),
            sa.CheckConstraint('effective_to IS NULL OR effective_from <= effective_to', name='chk_timetable_slots_effective_dates')
        )
        op.create_index('ix_timetable_slots_semester_id', 'timetable_slots', ['semester_id'], unique=False)
        op.create_index('ix_timetable_slots_subject_id', 'timetable_slots', ['subject_id'], unique=False)

    # 4. Academic calendar events
    if 'academic_calendar_events' not in existing_tables:
        op.create_table(
            'academic_calendar_events',
            sa.Column('id', sa.UUID(), nullable=False),
            sa.Column('semester_id', sa.UUID(), nullable=False),
            sa.Column('title', sa.String(), nullable=False),
            sa.Column('event_type', sa.String(), nullable=False),
            sa.Column('start_date', sa.Date(), nullable=False),
            sa.Column('end_date', sa.Date(), nullable=False),
            sa.Column('cancels_regular_classes', sa.Boolean(), server_default=sa.text('true'), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['semester_id'], ['semesters.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.CheckConstraint("event_type IN ('holiday', 'non_working_day', 'exam')", name='chk_academic_calendar_event_type'),
            sa.CheckConstraint('start_date <= end_date', name='chk_academic_calendar_event_dates')
        )
        op.create_index('ix_academic_calendar_events_semester_id', 'academic_calendar_events', ['semester_id'], unique=False)

    # 5. Academic calendar event subjects association table
    if 'academic_calendar_event_subjects' not in existing_tables:
        op.create_table(
            'academic_calendar_event_subjects',
            sa.Column('event_id', sa.UUID(), nullable=False),
            sa.Column('subject_id', sa.UUID(), nullable=False),
            sa.ForeignKeyConstraint(['event_id'], ['academic_calendar_events.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['subject_id'], ['subjects.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('event_id', 'subject_id')
        )

    # 6. Timetable overrides
    if 'timetable_overrides' not in existing_tables:
        op.create_table(
            'timetable_overrides',
            sa.Column('id', sa.UUID(), nullable=False),
            sa.Column('semester_id', sa.UUID(), nullable=False),
            sa.Column('subject_id', sa.UUID(), nullable=False),
            sa.Column('override_type', sa.String(), nullable=False),
            sa.Column('timetable_slot_id', sa.UUID(), nullable=True),
            sa.Column('original_date', sa.Date(), nullable=True),
            sa.Column('target_date', sa.Date(), nullable=False),
            sa.Column('start_time', sa.Time(), nullable=False),
            sa.Column('end_time', sa.Time(), nullable=False),
            sa.Column('note', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['semester_id'], ['semesters.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['subject_id'], ['subjects.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['timetable_slot_id'], ['timetable_slots.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
            sa.CheckConstraint("override_type IN ('cancelled', 'extra', 'rescheduled')", name='chk_timetable_overrides_type'),
            sa.CheckConstraint('start_time < end_time', name='chk_timetable_overrides_time_order')
        )
        op.create_index('ix_timetable_overrides_semester_id', 'timetable_overrides', ['semester_id'], unique=False)
        op.create_index('ix_timetable_overrides_target_date', 'timetable_overrides', ['target_date'], unique=False)

    # 7. Lecture attendances
    if 'lecture_attendances' not in existing_tables:
        op.create_table(
            'lecture_attendances',
            sa.Column('id', sa.UUID(), nullable=False),
            sa.Column('semester_id', sa.UUID(), nullable=False),
            sa.Column('subject_id', sa.UUID(), nullable=False),
            sa.Column('timetable_slot_id', sa.UUID(), nullable=True),
            sa.Column('override_id', sa.UUID(), nullable=True),
            sa.Column('lecture_date', sa.Date(), nullable=False),
            sa.Column('start_time', sa.Time(), nullable=False),
            sa.Column('end_time', sa.Time(), nullable=False),
            sa.Column('status', sa.String(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['semester_id'], ['semesters.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['subject_id'], ['subjects.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['timetable_slot_id'], ['timetable_slots.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['override_id'], ['timetable_overrides.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
            sa.CheckConstraint("status IN ('attended', 'missed', 'class_cancelled')", name='chk_lecture_attendances_status'),
            sa.CheckConstraint('start_time < end_time', name='chk_lecture_attendances_time_order')
        )
        op.create_index('ix_lecture_attendances_semester_id', 'lecture_attendances', ['semester_id'], unique=False)
        op.create_index('ix_lecture_attendances_subject_date', 'lecture_attendances', ['subject_id', 'lecture_date'], unique=False)
        op.create_index('uix_lecture_attendance_record', 'lecture_attendances', ['subject_id', 'lecture_date', 'start_time'], unique=True)


def downgrade() -> None:
    """Downgrade schema safely."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())

    if 'lecture_attendances' in existing_tables:
        op.drop_table('lecture_attendances')
    if 'timetable_overrides' in existing_tables:
        op.drop_table('timetable_overrides')
    if 'academic_calendar_event_subjects' in existing_tables:
        op.drop_table('academic_calendar_event_subjects')
    if 'academic_calendar_events' in existing_tables:
        op.drop_table('academic_calendar_events')
    if 'timetable_slots' in existing_tables:
        op.drop_table('timetable_slots')

    subjects_cols = {c['name'] for c in inspector.get_columns('subjects')}
    if 'attendance_target_percentage' in subjects_cols:
        op.drop_constraint('chk_subject_attendance_target_percentage', 'subjects', type_='check')
        op.drop_column('subjects', 'attendance_target_percentage')

    semesters_cols = {c['name'] for c in inspector.get_columns('semesters')}
    if 'start_date' in semesters_cols or 'end_date' in semesters_cols:
        op.drop_constraint('chk_semesters_date_order', 'semesters', type_='check')
        if 'end_date' in semesters_cols:
            op.drop_column('semesters', 'end_date')
        if 'start_date' in semesters_cols:
            op.drop_column('semesters', 'start_date')
