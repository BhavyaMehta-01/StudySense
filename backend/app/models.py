import uuid
from sqlalchemy import Column, String, Boolean, DateTime, Date, ForeignKey, Numeric, Integer, CheckConstraint, text, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    name = Column(String, nullable=False)
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
        Index("uix_active_semester_per_user", "user_id", unique=True, postgresql_where=text("is_active = true")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    academic_year = Column(String, nullable=False)
    is_active = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    user = relationship("User", back_populates="semesters")
    subjects = relationship("Subject", back_populates="semester", cascade="all, delete-orphan")


class Subject(Base):
    __tablename__ = "subjects"
    __table_args__ = (
        CheckConstraint(
            "target_percentage >= 0 AND target_percentage <= 100",
            name="chk_subject_target_percentage"
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    semester_id = Column(UUID(as_uuid=True), ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    code = Column(String, nullable=True)
    credits = Column(Numeric(5, 2), nullable=True)
    target_percentage = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    semester = relationship("Semester", back_populates="subjects")
    assessments = relationship("Assessment", back_populates="subject", cascade="all, delete-orphan")
    attendances = relationship("Attendance", back_populates="subject", cascade="all, delete-orphan")
    allocations = relationship("StudyPlanAllocation", back_populates="subject")


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
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    subject = relationship("Subject", back_populates="assessments")


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
