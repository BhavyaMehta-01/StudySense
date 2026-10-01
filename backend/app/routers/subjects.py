from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List
from uuid import UUID

from .. import schemas, models
from ..dependencies import get_db, get_current_user

router = APIRouter(prefix="/subjects", tags=["subjects"])

def get_subject_or_404(db: Session, subject_id: UUID, user_id: UUID) -> models.Subject:
    # Join with Semester to verify user_id ownership
    subject = db.query(models.Subject).join(models.Semester).filter(
        models.Subject.id == subject_id,
        models.Semester.user_id == user_id
    ).first()
    if not subject:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subject not found")
    return subject

@router.get("/{subject_id}", response_model=schemas.SubjectResponse)
def get_subject(
    subject_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    return get_subject_or_404(db, subject_id, current_user.id)

@router.put("/{subject_id}", response_model=schemas.SubjectResponse)
def update_subject(
    subject_id: UUID,
    subject_in: schemas.SubjectUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    subject = get_subject_or_404(db, subject_id, current_user.id)
    update_data = subject_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(subject, key, value)
    db.commit()
    db.refresh(subject)
    return subject

@router.delete("/{subject_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subject(
    subject_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    subject = get_subject_or_404(db, subject_id, current_user.id)
    db.delete(subject)
    db.commit()
    return None

@router.post("/{subject_id}/assessments", response_model=schemas.AssessmentResponse)
def create_assessment(
    subject_id: UUID,
    assessment_in: schemas.AssessmentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    subject = get_subject_or_404(db, subject_id, current_user.id)
    
    # Weightage validation
    if assessment_in.weightage is not None:
        from sqlalchemy import func
        current_weightage = db.query(func.sum(models.Assessment.weightage)).filter(
            models.Assessment.subject_id == subject.id
        ).scalar() or 0
        if current_weightage + assessment_in.weightage > 100:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Total weightage for this subject would exceed 100%"
            )
            
    assessment = models.Assessment(**assessment_in.model_dump(), subject_id=subject.id)
    db.add(assessment)
    try:
        db.commit()
        db.refresh(assessment)
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Database constraint violation")
    return assessment

@router.get("/{subject_id}/assessments", response_model=List[schemas.AssessmentResponse])
def list_assessments(
    subject_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    subject = get_subject_or_404(db, subject_id, current_user.id)
    return db.query(models.Assessment).filter(models.Assessment.subject_id == subject.id).all()

@router.post("/{subject_id}/attendance", response_model=schemas.AttendanceResponse)
def create_attendance(
    subject_id: UUID,
    attendance_in: schemas.AttendanceCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    subject = get_subject_or_404(db, subject_id, current_user.id)
    attendance = models.Attendance(**attendance_in.model_dump(), subject_id=subject.id)
    db.add(attendance)
    try:
        db.commit()
        db.refresh(attendance)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Database constraint violation")
    return attendance

@router.get("/{subject_id}/attendance", response_model=List[schemas.AttendanceResponse])
def list_attendance(
    subject_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    subject = get_subject_or_404(db, subject_id, current_user.id)
    return db.query(models.Attendance).filter(models.Attendance.subject_id == subject.id).all()

from ..calculator import calculate_required_score

@router.post("/{subject_id}/calculate-required", response_model=schemas.CalculatorResponse)
def calculate_subject_required_score(
    subject_id: UUID,
    request: schemas.CalculatorRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    subject = get_subject_or_404(db, subject_id, current_user.id)
    assessments = db.query(models.Assessment).filter(models.Assessment.subject_id == subject.id).all()
    ass_list = [
        {
            "status": a.status,
            "marks": a.marks,
            "max_marks": a.max_marks,
            "weightage": a.weightage
        }
        for a in assessments
    ]
    return calculate_required_score(request.target_percentage, ass_list)
