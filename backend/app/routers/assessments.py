from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List
from uuid import UUID

from .. import schemas, models
from ..dependencies import get_db, get_current_user

router = APIRouter(prefix="/assessments", tags=["assessments"])

def get_assessment_or_404(db: Session, assessment_id: UUID, user_id: UUID) -> models.Assessment:
    # Join Assessment -> Subject -> Semester to verify user_id ownership
    assessment = db.query(models.Assessment).join(models.Subject).join(models.Semester).filter(
        models.Assessment.id == assessment_id,
        models.Semester.user_id == user_id
    ).first()
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")
    return assessment

@router.get("/{assessment_id}", response_model=schemas.AssessmentResponse)
def get_assessment(
    assessment_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    return get_assessment_or_404(db, assessment_id, current_user.id)

@router.put("/{assessment_id}", response_model=schemas.AssessmentResponse)
def update_assessment(
    assessment_id: UUID,
    assessment_in: schemas.AssessmentUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    assessment = get_assessment_or_404(db, assessment_id, current_user.id)
    
    # Weightage validation
    if assessment_in.weightage is not None:
        from sqlalchemy import func
        # Sum of all OTHER assessments' weightage for this subject
        other_weightage = db.query(func.sum(models.Assessment.weightage)).filter(
            models.Assessment.subject_id == assessment.subject_id,
            models.Assessment.id != assessment.id
        ).scalar() or 0
        if other_weightage + assessment_in.weightage > 100:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Total weightage for this subject would exceed 100%"
            )

    update_data = assessment_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(assessment, key, value)
        
    try:
        db.commit()
        db.refresh(assessment)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Database constraint violation")
        
    return assessment

@router.delete("/{assessment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assessment(
    assessment_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    assessment = get_assessment_or_404(db, assessment_id, current_user.id)
    db.delete(assessment)
    db.commit()
    return None
