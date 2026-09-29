from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel
from decimal import Decimal

from .. import models
from ..dependencies import get_db, get_current_user

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

class SubjectSummary(BaseModel):
    subject_id: str
    subject_name: str
    earned_points: Decimal
    completed_weight: Decimal
    pending_weight: Decimal
    completed_work_percentage: Decimal | None
    attendance_percentage: Decimal | None

class DashboardSummary(BaseModel):
    total_semesters: int
    total_subjects: int
    subject_summaries: List[SubjectSummary]

@router.get("", response_model=DashboardSummary)
def get_dashboard(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    semesters = db.query(models.Semester).filter(models.Semester.user_id == current_user.id).all()
    semester_ids = [s.id for s in semesters]
    
    subjects = db.query(models.Subject).filter(models.Subject.semester_id.in_(semester_ids)).all()
    
    subject_summaries = []
    
    for subject in subjects:
        earned_points = Decimal('0.0')
        completed_weight = Decimal('0.0')
        pending_weight = Decimal('0.0')
        
        for ass in subject.assessments:
            weight = ass.weightage
            if not weight or weight <= 0 or ass.status == "exempt":
                continue
                
            if ass.status == "scored":
                if ass.marks is not None and ass.max_marks and ass.max_marks > 0:
                    earned_points += (ass.marks / ass.max_marks) * weight
                completed_weight += weight
            elif ass.status == "absent":
                completed_weight += weight
            elif ass.status == "pending":
                pending_weight += weight
                
        completed_work_percentage = None
        if completed_weight > 0:
            completed_work_percentage = (earned_points / completed_weight) * Decimal('100.0')
            
        classes_attended = sum(att.classes_attended for att in subject.attendances)
        classes_held = sum(att.classes_held for att in subject.attendances)
        
        attendance_percentage = None
        if classes_held > 0:
            attendance_percentage = (Decimal(classes_attended) / Decimal(classes_held)) * Decimal('100.0')
            
        subject_summaries.append(SubjectSummary(
            subject_id=str(subject.id),
            subject_name=subject.name,
            earned_points=round(earned_points, 2),
            completed_weight=round(completed_weight, 2),
            pending_weight=round(pending_weight, 2),
            completed_work_percentage=round(completed_work_percentage, 2) if completed_work_percentage is not None else None,
            attendance_percentage=round(attendance_percentage, 2) if attendance_percentage is not None else None
        ))
        
    return DashboardSummary(
        total_semesters=len(semesters),
        total_subjects=len(subjects),
        subject_summaries=subject_summaries
    )
