from pydantic import BaseModel, EmailStr
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
