import uuid
from sqlalchemy import Column, String, Boolean, DateTime, Date, ForeignKey, Numeric, Integer, CheckConstraint, text
from sqlalchemy.dialects.postgresql import UUID
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


class Semester(Base):
    __tablename__ = "semesters"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    academic_year = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    user = relationship("User", back_populates="semesters")
    subjects = relationship("Subject", back_populates="semester", cascade="all, delete-orphan")


class Subject(Base):
    __tablename__ = "subjects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    semester_id = Column(UUID(as_uuid=True), ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    code = Column(String, nullable=True)
    credits = Column(Numeric(5, 2), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=text("now()"), nullable=True)

    semester = relationship("Semester", back_populates="subjects")
    assessments = relationship("Assessment", back_populates="subject", cascade="all, delete-orphan")
    attendances = relationship("Attendance", back_populates="subject", cascade="all, delete-orphan")


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
