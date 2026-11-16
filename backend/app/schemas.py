from pydantic import BaseModel, EmailStr, model_validator, Field, field_validator
from uuid import UUID
import zoneinfo

class UserRegister(BaseModel):
    email: EmailStr
    password: str
    name: str
    timezone: str = "UTC"

    @field_validator('timezone')
    @classmethod
    def validate_timezone(cls, v: str) -> str:
        try:
            zoneinfo.ZoneInfo(v)
        except Exception:
            raise ValueError(f"Invalid IANA timezone: '{v}'")
        return v

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class SafeUserResponse(BaseModel):
    id: UUID
    email: EmailStr
    name: str
    timezone: str = "UTC"

    class Config:
        from_attributes = True

class UserTimezoneUpdate(BaseModel):
    timezone: str

    @field_validator('timezone')
    @classmethod
    def validate_timezone(cls, v: str) -> str:
        try:
            zoneinfo.ZoneInfo(v)
        except Exception:
            raise ValueError(f"Invalid IANA timezone: '{v}'")
        return v

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: SafeUserResponse

from datetime import datetime, date, time
from decimal import Decimal
from typing import Optional, List, Literal, Set

class SemesterBase(BaseModel):
    name: str
    academic_year: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None

    @model_validator(mode='after')
    def validate_date_order(self):
        if self.start_date is not None and self.end_date is not None:
            if self.end_date < self.start_date:
                raise ValueError("end_date cannot be before start_date")
        return self

class SemesterCreate(SemesterBase):
    pass

class SemesterUpdate(BaseModel):
    name: Optional[str] = None
    academic_year: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None

    @model_validator(mode='after')
    def validate_date_order(self):
        if self.start_date is not None and self.end_date is not None:
            if self.end_date < self.start_date:
                raise ValueError("end_date cannot be before start_date")
        return self

class SemesterResponse(SemesterBase):
    id: UUID
    user_id: UUID
    is_active: bool = False
    created_at: datetime
    updated_at: Optional[datetime]
    class Config: from_attributes = True

class SubjectBase(BaseModel):
    name: str
    code: Optional[str] = None
    credits: Optional[Decimal] = None
    target_percentage: Optional[int] = Field(default=None, ge=0, le=100)
    attendance_target_percentage: int = Field(default=75, ge=0, le=100)

    @field_validator('credits')
    @classmethod
    def validate_credits(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None:
            if v < 0:
                raise ValueError("Credits must be greater than or equal to 0")
            if v % Decimal('1') != 0:
                raise ValueError("Credits must be a whole number")
        return v

class SubjectCreate(SubjectBase):
    pass

class SubjectUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    credits: Optional[Decimal] = None
    target_percentage: Optional[int] = Field(default=None, ge=0, le=100)
    attendance_target_percentage: Optional[int] = Field(default=None, ge=0, le=100)

    @field_validator('credits')
    @classmethod
    def validate_credits(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None:
            if v < 0:
                raise ValueError("Credits must be greater than or equal to 0")
            if v % Decimal('1') != 0:
                raise ValueError("Credits must be a whole number")
        return v

class SubjectResponse(SubjectBase):
    id: UUID
    semester_id: UUID
    created_at: datetime
    updated_at: Optional[datetime]
    class Config: from_attributes = True


AssessmentCategory = Literal[
    "internal_test",
    "assignment",
    "quiz",
    "practical",
    "viva",
    "project",
    "midsem",
    "endsem",
    "other",
]

AssessmentStatus = Literal["pending", "scored", "absent", "exempt"]

class AssessmentBase(BaseModel):
    name: str
    category: AssessmentCategory
    max_marks: Decimal
    marks: Optional[Decimal] = None
    weightage: Optional[Decimal] = None
    scheduled_at: Optional[datetime] = None
    status: Optional[AssessmentStatus] = "pending"

    @field_validator('max_marks')
    @classmethod
    def validate_max_marks(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("Max marks must be greater than 0")
        if v % Decimal('0.5') != 0:
            raise ValueError("Max marks must be in increments of 0.5")
        return v

    @field_validator('marks')
    @classmethod
    def validate_marks(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None:
            if v < 0:
                raise ValueError("Marks must be greater than or equal to 0")
            if v % Decimal('0.5') != 0:
                raise ValueError("Marks must be in increments of 0.5")
        return v

    @field_validator('weightage')
    @classmethod
    def validate_weightage(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None:
            if v <= 0:
                raise ValueError("Weightage must be greater than 0")
            if v % Decimal('0.5') != 0:
                raise ValueError("Weightage must be in increments of 0.5")
        return v

    @model_validator(mode='after')
    def validate_status_and_marks(self):
        if self.marks is not None:
            if 'status' not in self.model_fields_set or self.status is None:
                self.status = 'scored'
            elif self.status in ('pending', 'absent', 'exempt'):
                raise ValueError(f"{self.status.capitalize()} assessments must not contain marks")

        if self.status == 'scored' and self.marks is None:
            raise ValueError("Marks are required when status is 'scored'")
        if self.status in ('pending', 'absent', 'exempt') and self.marks is not None:
            raise ValueError(f"{self.status.capitalize()} assessments must not contain marks")
        if self.marks is not None and self.max_marks is not None and self.marks > self.max_marks:
            raise ValueError("Marks cannot exceed max marks")
        return self

class AssessmentCreate(AssessmentBase):
    pass

class AssessmentUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[AssessmentCategory] = None
    max_marks: Optional[Decimal] = None
    marks: Optional[Decimal] = None
    weightage: Optional[Decimal] = None
    scheduled_at: Optional[datetime] = None
    status: Optional[AssessmentStatus] = None

    @field_validator('max_marks')
    @classmethod
    def validate_max_marks(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None:
            if v <= 0:
                raise ValueError("Max marks must be greater than 0")
            if v % Decimal('0.5') != 0:
                raise ValueError("Max marks must be in increments of 0.5")
        return v

    @field_validator('marks')
    @classmethod
    def validate_marks(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None:
            if v < 0:
                raise ValueError("Marks must be greater than or equal to 0")
            if v % Decimal('0.5') != 0:
                raise ValueError("Marks must be in increments of 0.5")
        return v

    @field_validator('weightage')
    @classmethod
    def validate_weightage(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None:
            if v <= 0:
                raise ValueError("Weightage must be greater than 0")
            if v % Decimal('0.5') != 0:
                raise ValueError("Weightage must be in increments of 0.5")
        return v

    @model_validator(mode='after')
    def validate_status_and_marks(self):
        if self.status == 'scored' and 'marks' in self.model_fields_set and self.marks is None:
            raise ValueError("Marks are required when status is 'scored'")
        if self.status in ('pending', 'absent', 'exempt') and self.marks is not None:
            raise ValueError(f"{self.status.capitalize()} assessments must not contain marks")
        if self.marks is not None and self.max_marks is not None and self.marks > self.max_marks:
            raise ValueError("Marks cannot exceed max marks")
        return self

class AssessmentResponse(AssessmentBase):
    id: UUID
    subject_id: UUID
    calendar_event_id: Optional[UUID] = None
    pattern_component_id: Optional[UUID] = None
    is_auto_generated: bool = False
    created_at: datetime
    updated_at: Optional[datetime]
    class Config: from_attributes = True


class AssessmentPatternComponentBase(BaseModel):
    name: str
    category: AssessmentCategory
    max_marks: Decimal
    weightage: Decimal
    is_active: bool = True
    order_index: int = 0

    @field_validator('max_marks')
    @classmethod
    def validate_max_marks(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("Max marks must be greater than 0")
        if v % Decimal('0.5') != 0:
            raise ValueError("Max marks must be in increments of 0.5")
        return v

    @field_validator('weightage')
    @classmethod
    def validate_weightage(cls, v: Decimal) -> Decimal:
        if v < 0 or v > 100:
            raise ValueError("Weightage must be between 0 and 100")
        if v % Decimal('0.5') != 0:
            raise ValueError("Weightage must be in increments of 0.5")
        return v

    @model_validator(mode='after')
    def validate_active_weightage(self):
        if self.is_active and self.weightage <= 0:
            raise ValueError("Active assessment pattern components must have weightage greater than 0")
        return self


class AssessmentPatternComponentCreate(AssessmentPatternComponentBase):
    pass


class AssessmentPatternComponentUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[AssessmentCategory] = None
    max_marks: Optional[Decimal] = None
    weightage: Optional[Decimal] = None
    is_active: Optional[bool] = None
    order_index: Optional[int] = None

    @field_validator('max_marks')
    @classmethod
    def validate_max_marks(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None:
            if v <= 0:
                raise ValueError("Max marks must be greater than 0")
            if v % Decimal('0.5') != 0:
                raise ValueError("Max marks must be in increments of 0.5")
        return v

    @field_validator('weightage')
    @classmethod
    def validate_weightage(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None:
            if v < 0 or v > 100:
                raise ValueError("Weightage must be between 0 and 100")
            if v % Decimal('0.5') != 0:
                raise ValueError("Weightage must be in increments of 0.5")
        return v

    @model_validator(mode='after')
    def validate_update_weightage(self):
        if self.is_active is True and self.weightage is not None and self.weightage <= 0:
            raise ValueError("Active assessment pattern components must have weightage greater than 0")
        return self


class AssessmentPatternComponentResponse(AssessmentPatternComponentBase):
    id: UUID
    pattern_id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AssessmentPatternBase(BaseModel):
    name: str
    is_active: bool = True


class AssessmentPatternCreate(AssessmentPatternBase):
    components: Optional[list[AssessmentPatternComponentCreate]] = None

    @field_validator('components')
    @classmethod
    def validate_components_weightage(cls, components: Optional[list[AssessmentPatternComponentCreate]]) -> Optional[list[AssessmentPatternComponentCreate]]:
        if components:
            active_weightage = sum(c.weightage for c in components if c.is_active)
            if active_weightage > 100:
                raise ValueError("Total weightage of active components cannot exceed 100")
        return components


class AssessmentPatternUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None


class AssessmentPatternResponse(AssessmentPatternBase):
    id: UUID
    subject_id: UUID
    components: list[AssessmentPatternComponentResponse] = []
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class AttendanceBase(BaseModel):
    classes_attended: int
    classes_held: int
    recorded_on: date

    @field_validator('classes_held', mode='before')
    @classmethod
    def validate_classes_held(cls, v):
        if v is not None:
            if isinstance(v, float) and not v.is_integer():
                raise ValueError("Classes held must be a whole number.")
            try:
                num = float(v)
                if not num.is_integer():
                    raise ValueError("Classes held must be a whole number.")
                if int(num) <= 0:
                    raise ValueError("Classes held must be greater than zero.")
                return int(num)
            except (ValueError, TypeError) as e:
                if "whole number" in str(e) or "greater than zero" in str(e):
                    raise
                raise ValueError("Classes held must be a whole number.")
        return v

    @field_validator('classes_attended', mode='before')
    @classmethod
    def validate_classes_attended(cls, v):
        if v is not None:
            if isinstance(v, float) and not v.is_integer():
                raise ValueError("Classes attended must be a whole number.")
            try:
                num = float(v)
                if not num.is_integer():
                    raise ValueError("Classes attended must be a whole number.")
                if int(num) < 0:
                    raise ValueError("Must be integer ≥ 0.")
                return int(num)
            except (ValueError, TypeError) as e:
                if "whole number" in str(e) or "integer" in str(e):
                    raise
                raise ValueError("Classes attended must be a whole number.")
        return v

    @model_validator(mode='after')
    def validate_attendance_logic(self):
        if self.classes_attended > self.classes_held:
            raise ValueError("Classes attended cannot exceed classes held")
        return self

class AttendanceCreate(AttendanceBase):
    pass

class AttendanceUpdate(BaseModel):
    classes_attended: Optional[int] = None
    classes_held: Optional[int] = None
    recorded_on: Optional[date] = None

    @field_validator('classes_held', mode='before')
    @classmethod
    def validate_classes_held(cls, v):
        if v is not None:
            if isinstance(v, float) and not v.is_integer():
                raise ValueError("Classes held must be a whole number.")
            try:
                num = float(v)
                if not num.is_integer():
                    raise ValueError("Classes held must be a whole number.")
                if int(num) <= 0:
                    raise ValueError("Classes held must be greater than zero.")
                return int(num)
            except (ValueError, TypeError) as e:
                if "whole number" in str(e) or "greater than zero" in str(e):
                    raise
                raise ValueError("Classes held must be a whole number.")
        return v

    @field_validator('classes_attended', mode='before')
    @classmethod
    def validate_classes_attended(cls, v):
        if v is not None:
            if isinstance(v, float) and not v.is_integer():
                raise ValueError("Classes attended must be a whole number.")
            try:
                num = float(v)
                if not num.is_integer():
                    raise ValueError("Classes attended must be a whole number.")
                if int(num) < 0:
                    raise ValueError("Must be integer ≥ 0.")
                return int(num)
            except (ValueError, TypeError) as e:
                if "whole number" in str(e) or "integer" in str(e):
                    raise
                raise ValueError("Classes attended must be a whole number.")
        return v

    @model_validator(mode='after')
    def validate_attendance_logic(self):
        if self.classes_attended is not None and self.classes_held is not None:
            if self.classes_attended > self.classes_held:
                raise ValueError("Classes attended cannot exceed classes held")
        return self

class AttendanceResponse(AttendanceBase):
    id: UUID
    subject_id: UUID
    created_at: datetime
    updated_at: Optional[datetime]
    class Config: from_attributes = True

class CalculatorRequest(BaseModel):
    target_percentage: Decimal = Field(..., ge=0, le=100)

class CalculatorResponse(BaseModel):
    earned_points: Decimal
    remaining_weight: Decimal
    total_valid_weight: Decimal
    target_achieved: bool
    impossible: bool
    required_remaining_percentage: Decimal
    required_points_from_remaining: Decimal
    max_achievable_score: Optional[Decimal] = None

class StudyPlanCreate(BaseModel):
    start_date: date
    end_date: date
    available_minutes: int

    @model_validator(mode='after')
    def check_dates_and_minutes(self):
        if self.start_date > self.end_date:
            raise ValueError("start_date must be before or equal to end_date")
        if self.start_date.weekday() != 0:
            raise ValueError("start_date must be a Monday")
        if self.end_date.weekday() != 6:
            raise ValueError("end_date must be a Sunday")
        if self.available_minutes <= 0:
            raise ValueError("available_minutes must be positive")
        if self.available_minutes % 5 != 0:
            raise ValueError("available_minutes must be divisible by 5")
        return self

class StudyPlanAllocationResponse(BaseModel):
    id: UUID
    plan_id: UUID
    subject_id: Optional[UUID] = None
    allocated_minutes: int
    snapshot_state: dict
    explanation_code: str
    class Config: from_attributes = True

class StudyPlanResponse(BaseModel):
    id: UUID
    user_id: UUID
    start_date: date
    end_date: date
    available_minutes: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime]
    allocations: List[StudyPlanAllocationResponse] = []
    class Config: from_attributes = True

class StudySessionCreate(BaseModel):
    allocation_id: UUID
    date: date
    duration_minutes: int
    status: str

    @model_validator(mode='after')
    def validate_duration_and_status(self):
        if self.duration_minutes < 0:
            raise ValueError("duration_minutes must be >= 0")
        if self.status not in ("completed", "partial", "skipped"):
            raise ValueError("status must be 'completed', 'partial', or 'skipped'")
        if self.status == "skipped" and self.duration_minutes != 0:
            raise ValueError("duration_minutes must be 0 when status is 'skipped'")
        if self.status in ("completed", "partial") and self.duration_minutes <= 0:
            raise ValueError(f"duration_minutes must be > 0 when status is '{self.status}'")
        return self

class StudySessionResponse(BaseModel):
    id: UUID
    allocation_id: Optional[UUID] = None
    user_id: UUID
    date: date
    duration_minutes: int
    status: str
    created_at: datetime
    updated_at: Optional[datetime]
    class Config: from_attributes = True


# --- Timetable-Driven Attendance Schemas ---

class TimetableSlotBase(BaseModel):
    subject_id: UUID
    day_of_week: int = Field(ge=0, le=6, description="0=Monday .. 6=Sunday")
    start_time: time
    end_time: time
    effective_from: date
    effective_to: Optional[date] = None

    @model_validator(mode='after')
    def validate_slot_constraints(self):
        if self.start_time >= self.end_time:
            raise ValueError("start_time must be before end_time")
        if self.effective_to is not None and self.effective_from > self.effective_to:
            raise ValueError("effective_from cannot be after effective_to")
        return self

class TimetableSlotCreate(TimetableSlotBase):
    pass

class TimetableSlotUpdate(BaseModel):
    day_of_week: Optional[int] = Field(default=None, ge=0, le=6)
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None

    @model_validator(mode='after')
    def validate_slot_constraints(self):
        if self.start_time is not None and self.end_time is not None:
            if self.start_time >= self.end_time:
                raise ValueError("start_time must be before end_time")
        if self.effective_from is not None and self.effective_to is not None:
            if self.effective_from > self.effective_to:
                raise ValueError("effective_from cannot be after effective_to")
        return self

class TimetableSlotResponse(TimetableSlotBase):
    id: UUID
    semester_id: UUID
    created_at: datetime
    updated_at: Optional[datetime]
    class Config: from_attributes = True


CalendarEventType = Literal["holiday", "non_working_day", "exam"]

class AcademicCalendarEventBase(BaseModel):
    title: str
    event_type: CalendarEventType
    start_date: date
    end_date: date
    cancels_regular_classes: bool = True
    subject_ids: List[UUID] = []

    @model_validator(mode='after')
    def validate_event_dates(self):
        if self.start_date > self.end_date:
            raise ValueError("start_date cannot be after end_date")
        return self

class ExamSubjectComponentSelection(BaseModel):
    subject_id: UUID
    pattern_component_id: UUID

class AcademicCalendarEventCreate(AcademicCalendarEventBase):
    subject_components: Optional[List[ExamSubjectComponentSelection]] = None

class AcademicCalendarEventUpdate(BaseModel):
    title: Optional[str] = None
    event_type: Optional[CalendarEventType] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    cancels_regular_classes: Optional[bool] = None
    subject_ids: Optional[List[UUID]] = None
    subject_components: Optional[List[ExamSubjectComponentSelection]] = None

    @model_validator(mode='after')
    def validate_event_dates(self):
        if self.start_date is not None and self.end_date is not None:
            if self.start_date > self.end_date:
                raise ValueError("start_date cannot be after end_date")
        return self

class AcademicCalendarEventResponse(AcademicCalendarEventBase):
    id: UUID
    semester_id: UUID
    assessment_ids: List[UUID] = []
    created_at: datetime
    updated_at: Optional[datetime]
    class Config: from_attributes = True


OverrideType = Literal["cancelled", "extra", "rescheduled"]

class TimetableOverrideBase(BaseModel):
    subject_id: UUID
    override_type: OverrideType
    target_date: date
    start_time: time
    end_time: time
    timetable_slot_id: Optional[UUID] = None
    original_date: Optional[date] = None
    note: Optional[str] = None

    @model_validator(mode='after')
    def validate_override(self):
        if self.start_time >= self.end_time:
            raise ValueError("start_time must be before end_time")
        if self.override_type in ("cancelled", "rescheduled") and self.original_date is None:
            raise ValueError(f"original_date is required for override_type='{self.override_type}'")
        return self

class TimetableOverrideCreate(TimetableOverrideBase):
    pass

class TimetableOverrideResponse(TimetableOverrideBase):
    id: UUID
    semester_id: UUID
    created_at: datetime
    updated_at: Optional[datetime]
    class Config: from_attributes = True


AttendanceStatus = Literal["attended", "missed", "class_cancelled"]

class LectureAttendanceBase(BaseModel):
    subject_id: UUID
    lecture_date: date
    start_time: time
    end_time: time
    status: AttendanceStatus
    timetable_slot_id: Optional[UUID] = None
    override_id: Optional[UUID] = None

    @model_validator(mode='after')
    def validate_lecture_attendance(self):
        if self.start_time >= self.end_time:
            raise ValueError("start_time must be before end_time")
        return self

class LectureAttendanceCreate(LectureAttendanceBase):
    pass

class LectureAttendanceResponse(LectureAttendanceBase):
    id: UUID
    semester_id: UUID
    created_at: datetime
    updated_at: Optional[datetime]
    class Config: from_attributes = True


class AttendanceMetricsResponse(BaseModel):
    attended: int
    missed: int
    held: int
    cancelled: int
    target_percentage: int
    percentage: Optional[Decimal]
    is_at_or_above_target: bool
    classes_to_attend: Optional[int]
    classes_can_miss: Optional[int]
    impossible_to_reach_target: bool


class LectureOccurrenceResponse(BaseModel):
    lecture_date: date
    start_time: time
    end_time: time
    subject_id: UUID
    subject_name: Optional[str] = None
    subject_code: Optional[str] = None
    occurrence_type: str
    is_cancelled: bool
    cancellation_reason: Optional[str] = None
    timetable_slot_id: Optional[UUID] = None
    override_id: Optional[UUID] = None
    attendance_id: Optional[UUID] = None
    attendance_status: Optional[str] = None

