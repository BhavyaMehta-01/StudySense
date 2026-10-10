from pydantic import BaseModel, EmailStr, model_validator
from uuid import UUID

class UserRegister(BaseModel):
    email: EmailStr
    password: str
    name: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class SafeUserResponse(BaseModel):
    id: UUID
    email: EmailStr
    name: str

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: SafeUserResponse

from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List

class SemesterBase(BaseModel):
    name: str
    academic_year: str

class SemesterCreate(SemesterBase):
    pass

class SemesterUpdate(BaseModel):
    name: Optional[str] = None
    academic_year: Optional[str] = None

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

class SubjectCreate(SubjectBase):
    pass

class SubjectUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    credits: Optional[Decimal] = None

class SubjectResponse(SubjectBase):
    id: UUID
    semester_id: UUID
    created_at: datetime
    updated_at: Optional[datetime]
    class Config: from_attributes = True


class AssessmentBase(BaseModel):
    name: str
    category: str
    max_marks: Decimal
    marks: Optional[Decimal] = None
    weightage: Optional[Decimal] = None
    scheduled_at: Optional[datetime] = None
    status: Optional[str] = "pending"

    @model_validator(mode='after')
    def check_scored_marks(self):
        if self.status == 'scored' and self.marks is None:
            raise ValueError("Marks are required when status is 'scored'")
        return self

class AssessmentCreate(AssessmentBase):
    pass

class AssessmentUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    max_marks: Optional[Decimal] = None
    marks: Optional[Decimal] = None
    weightage: Optional[Decimal] = None
    scheduled_at: Optional[datetime] = None
    status: Optional[str] = None

    @model_validator(mode='after')
    def check_scored_marks(self):
        if self.status == 'scored' and 'marks' in self.model_fields_set and self.marks is None:
            raise ValueError("Marks are required when status is 'scored'")
        return self

class AssessmentResponse(AssessmentBase):
    id: UUID
    subject_id: UUID
    created_at: datetime
    updated_at: Optional[datetime]
    class Config: from_attributes = True

class AttendanceBase(BaseModel):
    classes_attended: int
    classes_held: int
    recorded_on: date

class AttendanceCreate(AttendanceBase):
    pass

class AttendanceUpdate(BaseModel):
    classes_attended: Optional[int] = None
    classes_held: Optional[int] = None
    recorded_on: Optional[date] = None

class AttendanceResponse(AttendanceBase):
    id: UUID
    subject_id: UUID
    created_at: datetime
    updated_at: Optional[datetime]
    class Config: from_attributes = True

class CalculatorRequest(BaseModel):
    target_percentage: Decimal

class CalculatorResponse(BaseModel):
    earned_points: Decimal
    remaining_weight: Decimal
    total_valid_weight: Decimal
    target_achieved: bool
    impossible: bool
    required_remaining_percentage: Decimal
    required_points_from_remaining: Decimal

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
