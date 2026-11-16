import uuid
from sqlalchemy import Column, String, Boolean, DateTime, Date, Time, ForeignKey, Numeric, Integer, CheckConstraint, Table, text, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    name = Column(String, nullable=False)
    timezone = Column(String, nullable=False, default="UTC", server_default=text("'UTC'"))
    data_donation_consent = Column(Boolean, default=False, nullable=False)
    consent_updated_at = Column(DateTime(timezone=True), nullable=True)
    consent_text_version = Column(String, nullable=True)
    anon_id = Column(UUID(as_uuid=True), unique=True, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    semesters = relationship("Semester", back_populates="user", cascade="all, delete-orphan")
    study_plans = relationship("StudyPlan", back_populates="user", cascade="all, delete-orphan")
    study_sessions = relationship("StudySession", back_populates="user", cascade="all, delete-orphan")


class Semester(Base):
    __tablename__ = "semesters"
    __table_args__ = (
        CheckConstraint(
            "start_date IS NULL OR end_date IS NULL OR start_date <= end_date",
            name="chk_semesters_date_order"
        ),
        Index("uix_active_semester_per_user", "user_id", unique=True, postgresql_where=text("is_active = true")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    academic_year = Column(String, nullable=False)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    is_active = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    user = relationship("User", back_populates="semesters")
    subjects = relationship("Subject", back_populates="semester", cascade="all, delete-orphan")
    timetable_slots = relationship("TimetableSlot", back_populates="semester", cascade="all, delete-orphan")
    calendar_events = relationship("AcademicCalendarEvent", back_populates="semester", cascade="all, delete-orphan")
    timetable_overrides = relationship("TimetableOverride", back_populates="semester", cascade="all, delete-orphan")
    lecture_attendances = relationship("LectureAttendance", back_populates="semester", cascade="all, delete-orphan")


# Association table for academic calendar events and affected subjects (e.g. exams)
academic_calendar_event_subjects = Table(
    "academic_calendar_event_subjects",
    Base.metadata,
    Column("event_id", UUID(as_uuid=True), ForeignKey("academic_calendar_events.id", ondelete="CASCADE"), primary_key=True),
    Column("subject_id", UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="CASCADE"), primary_key=True),
)


class Subject(Base):
    __tablename__ = "subjects"
    __table_args__ = (
        CheckConstraint(
            "target_percentage >= 0 AND target_percentage <= 100",
            name="chk_subject_target_percentage"
        ),
        CheckConstraint(
            "attendance_target_percentage >= 0 AND attendance_target_percentage <= 100",
            name="chk_subject_attendance_target_percentage"
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    semester_id = Column(UUID(as_uuid=True), ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    code = Column(String, nullable=True)
    credits = Column(Numeric(5, 2), nullable=True)
    target_percentage = Column(Integer, nullable=True)
    attendance_target_percentage = Column(Integer, nullable=False, default=75, server_default=text("75"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    semester = relationship("Semester", back_populates="subjects")
    assessments = relationship("Assessment", back_populates="subject", cascade="all, delete-orphan")
    attendances = relationship("Attendance", back_populates="subject", cascade="all, delete-orphan")
    allocations = relationship("StudyPlanAllocation", back_populates="subject")
    timetable_slots = relationship("TimetableSlot", back_populates="subject", cascade="all, delete-orphan")
    timetable_overrides = relationship("TimetableOverride", back_populates="subject", cascade="all, delete-orphan")
    lecture_attendances = relationship("LectureAttendance", back_populates="subject", cascade="all, delete-orphan")
    calendar_events = relationship("AcademicCalendarEvent", secondary=academic_calendar_event_subjects, back_populates="subjects")
    assessment_patterns = relationship("AssessmentPattern", back_populates="subject", cascade="all, delete-orphan")


class AssessmentPattern(Base):
    __tablename__ = "assessment_patterns"
    __table_args__ = (
        Index("ix_assessment_patterns_subject_id", "subject_id"),
        Index("uq_assessment_patterns_subject_active", "subject_id", unique=True, postgresql_where=text("is_active = true")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_id = Column(UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    subject = relationship("Subject", back_populates="assessment_patterns")
    components = relationship("AssessmentPatternComponent", back_populates="pattern", cascade="all, delete-orphan", order_by="AssessmentPatternComponent.order_index")


class AssessmentPatternComponent(Base):
    __tablename__ = "assessment_pattern_components"
    __table_args__ = (
        CheckConstraint("max_marks > 0", name="chk_pattern_components_max_marks"),
        CheckConstraint(
            "weightage >= 0 AND weightage <= 100 AND (NOT is_active OR weightage > 0)",
            name="chk_pattern_components_weightage"
        ),
        CheckConstraint(
            "category IN ('internal_test', 'assignment', 'quiz', 'practical', 'viva', 'project', 'midsem', 'endsem', 'other')",
            name="chk_pattern_components_category"
        ),
        Index("ix_assessment_pattern_components_pattern_id", "pattern_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pattern_id = Column(UUID(as_uuid=True), ForeignKey("assessment_patterns.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)
    max_marks = Column(Numeric(7, 2), nullable=False)
    weightage = Column(Numeric(5, 2), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    order_index = Column(Integer, nullable=False, default=0, server_default=text("0"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    pattern = relationship("AssessmentPattern", back_populates="components")
    assessments = relationship("Assessment", back_populates="pattern_component", passive_deletes=True)

    @property
    def is_valid_for_generation(self) -> bool:
        return bool(self.is_active and self.weightage and self.weightage > 0 and self.max_marks > 0)


class Assessment(Base):
    __tablename__ = "assessments"
    __table_args__ = (
        CheckConstraint("max_marks > 0", name="chk_assessments_max_marks"),
        CheckConstraint("marks >= 0", name="chk_assessments_marks_min"),
        CheckConstraint("marks <= max_marks", name="chk_assessments_marks_max"),
        CheckConstraint("weightage > 0", name="chk_assessments_weightage_min"),
        CheckConstraint("weightage <= 100", name="chk_assessments_weightage_max"),
        CheckConstraint(
            "category IN ('internal_test', 'assignment', 'quiz', 'practical', 'viva', 'project', 'midsem', 'endsem', 'other')",
            name="chk_assessments_category"
        ),
        CheckConstraint(
            "status IN ('pending', 'scored', 'absent', 'exempt')",
            name="chk_assessments_status"
        ),
        CheckConstraint(
            "status != 'scored' OR marks IS NOT NULL",
            name="chk_assessments_scored_marks"
        ),
        Index("ix_assessments_calendar_event_id", "calendar_event_id"),
        Index("ix_assessments_pattern_component_id", "pattern_component_id"),
        Index(
            "uq_assessments_calendar_event_subject",
            "calendar_event_id",
            "subject_id",
            unique=True,
            postgresql_where=text("calendar_event_id IS NOT NULL"),
        ),
        Index(
            "uq_assessments_component_active_event",
            "pattern_component_id",
            unique=True,
            postgresql_where=text("pattern_component_id IS NOT NULL AND calendar_event_id IS NOT NULL"),
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_id = Column(UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)
    max_marks = Column(Numeric(7, 2), nullable=False)
    marks = Column(Numeric(7, 2), nullable=True)
    weightage = Column(Numeric(5, 2), nullable=True)
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, default="pending", nullable=False)
    calendar_event_id = Column(UUID(as_uuid=True), ForeignKey("academic_calendar_events.id", ondelete="SET NULL"), nullable=True)
    pattern_component_id = Column(UUID(as_uuid=True), ForeignKey("assessment_pattern_components.id", ondelete="SET NULL"), nullable=True)
    is_auto_generated = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    subject = relationship("Subject", back_populates="assessments")
    calendar_event = relationship("AcademicCalendarEvent", back_populates="assessments")
    pattern_component = relationship("AssessmentPatternComponent", back_populates="assessments")


class Attendance(Base):
    __tablename__ = "attendances"
    __table_args__ = (
        CheckConstraint("classes_attended >= 0", name="chk_attendances_attended_min"),
        CheckConstraint("classes_held > 0", name="chk_attendances_held_min"),
        CheckConstraint("classes_attended <= classes_held", name="chk_attendances_logic"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_id = Column(UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False)
    classes_attended = Column(Integer, nullable=False)
    classes_held = Column(Integer, nullable=False)
    recorded_on = Column(Date, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    subject = relationship("Subject", back_populates="attendances")


class StudyPlan(Base):
    __tablename__ = "study_plans"
    __table_args__ = (
        CheckConstraint("available_minutes > 0", name="check_plan_minutes_positive"),
        CheckConstraint("MOD(available_minutes, 5) = 0", name="check_plan_minutes_div_5"),
        CheckConstraint("start_date <= end_date", name="check_plan_dates"),
        Index("uix_active_plan_per_user", "user_id", unique=True, postgresql_where=text("is_active = true")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    available_minutes = Column(Integer, nullable=False)
    is_active = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    user = relationship("User", back_populates="study_plans")
    allocations = relationship("StudyPlanAllocation", back_populates="plan", cascade="all, delete-orphan")


class StudyPlanAllocation(Base):
    __tablename__ = "study_plan_allocations"
    __table_args__ = (
        CheckConstraint("allocated_minutes >= 0", name="check_alloc_minutes_positive"),
        CheckConstraint("MOD(allocated_minutes, 5) = 0", name="check_alloc_minutes_div_5"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("study_plans.id", ondelete="CASCADE"), nullable=False)
    subject_id = Column(UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True)
    allocated_minutes = Column(Integer, nullable=False)
    snapshot_state = Column(JSONB, nullable=False)
    explanation_code = Column(String, nullable=False)

    plan = relationship("StudyPlan", back_populates="allocations")
    subject = relationship("Subject", back_populates="allocations")
    sessions = relationship("StudySession", back_populates="allocation")


class StudySession(Base):
    __tablename__ = "study_sessions"
    __table_args__ = (
        CheckConstraint("duration_minutes >= 0", name="check_session_duration_positive"),
        CheckConstraint("status IN ('completed', 'partial', 'skipped')", name="check_session_status_valid"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    allocation_id = Column(UUID(as_uuid=True), ForeignKey("study_plan_allocations.id", ondelete="SET NULL"), nullable=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    duration_minutes = Column(Integer, nullable=False)
    status = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    allocation = relationship("StudyPlanAllocation", back_populates="sessions")
    user = relationship("User", back_populates="study_sessions")


class TimetableSlot(Base):
    __tablename__ = "timetable_slots"
    __table_args__ = (
        CheckConstraint("day_of_week >= 0 AND day_of_week <= 6", name="chk_timetable_slots_day_of_week"),
        CheckConstraint("start_time < end_time", name="chk_timetable_slots_time_order"),
        CheckConstraint("effective_to IS NULL OR effective_from <= effective_to", name="chk_timetable_slots_effective_dates"),
        Index("ix_timetable_slots_semester_id", "semester_id"),
        Index("ix_timetable_slots_subject_id", "subject_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    semester_id = Column(UUID(as_uuid=True), ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False)
    subject_id = Column(UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False)
    day_of_week = Column(Integer, nullable=False)  # 0 = Monday .. 6 = Sunday
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    semester = relationship("Semester", back_populates="timetable_slots")
    subject = relationship("Subject", back_populates="timetable_slots")
    overrides = relationship("TimetableOverride", back_populates="timetable_slot")
    lecture_attendances = relationship("LectureAttendance", back_populates="timetable_slot")


class AcademicCalendarEvent(Base):
    __tablename__ = "academic_calendar_events"
    __table_args__ = (
        CheckConstraint("event_type IN ('holiday', 'non_working_day', 'exam')", name="chk_academic_calendar_event_type"),
        CheckConstraint("start_date <= end_date", name="chk_academic_calendar_event_dates"),
        Index("ix_academic_calendar_events_semester_id", "semester_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    semester_id = Column(UUID(as_uuid=True), ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False)
    title = Column(String, nullable=False)
    event_type = Column(String, nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    cancels_regular_classes = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    semester = relationship("Semester", back_populates="calendar_events")
    subjects = relationship("Subject", secondary=academic_calendar_event_subjects, back_populates="calendar_events")
    assessments = relationship("Assessment", back_populates="calendar_event", passive_deletes=True)


class TimetableOverride(Base):
    __tablename__ = "timetable_overrides"
    __table_args__ = (
        CheckConstraint("override_type IN ('cancelled', 'extra', 'rescheduled')", name="chk_timetable_overrides_type"),
        CheckConstraint("start_time < end_time", name="chk_timetable_overrides_time_order"),
        Index("ix_timetable_overrides_semester_id", "semester_id"),
        Index("ix_timetable_overrides_target_date", "target_date"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    semester_id = Column(UUID(as_uuid=True), ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False)
    subject_id = Column(UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False)
    override_type = Column(String, nullable=False)
    timetable_slot_id = Column(UUID(as_uuid=True), ForeignKey("timetable_slots.id", ondelete="SET NULL"), nullable=True)
    original_date = Column(Date, nullable=True)
    target_date = Column(Date, nullable=False)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    note = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    semester = relationship("Semester", back_populates="timetable_overrides")
    subject = relationship("Subject", back_populates="timetable_overrides")
    timetable_slot = relationship("TimetableSlot", back_populates="overrides")
    lecture_attendances = relationship("LectureAttendance", back_populates="override")


class LectureAttendance(Base):
    __tablename__ = "lecture_attendances"
    __table_args__ = (
        CheckConstraint("status IN ('attended', 'missed', 'class_cancelled')", name="chk_lecture_attendances_status"),
        CheckConstraint("start_time < end_time", name="chk_lecture_attendances_time_order"),
        Index("ix_lecture_attendances_semester_id", "semester_id"),
        Index("ix_lecture_attendances_subject_date", "subject_id", "lecture_date"),
        Index("uix_lecture_attendance_record", "subject_id", "lecture_date", "start_time", unique=True),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    semester_id = Column(UUID(as_uuid=True), ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False)
    subject_id = Column(UUID(as_uuid=True), ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False)
    timetable_slot_id = Column(UUID(as_uuid=True), ForeignKey("timetable_slots.id", ondelete="SET NULL"), nullable=True)
    override_id = Column(UUID(as_uuid=True), ForeignKey("timetable_overrides.id", ondelete="SET NULL"), nullable=True)
    lecture_date = Column(Date, nullable=False)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    status = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    semester = relationship("Semester", back_populates="lecture_attendances")
    subject = relationship("Subject", back_populates="lecture_attendances")
    timetable_slot = relationship("TimetableSlot", back_populates="lecture_attendances")
    override = relationship("TimetableOverride", back_populates="lecture_attendances")

