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

    # Duplicate name validation within same subject (case-insensitive, trimmed)
    if assessment_in.name is not None:
        normalized_name = assessment_in.name.strip()
        if normalized_name.lower() != assessment.name.strip().lower():
            from sqlalchemy import func
            existing_assessment = db.query(models.Assessment).filter(
                models.Assessment.subject_id == assessment.subject_id,
                models.Assessment.id != assessment.id,
                func.lower(func.trim(models.Assessment.name)) == normalized_name.lower()
            ).first()
            if existing_assessment:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="An assessment with this name already exists in this subject"
                )

    update_data = assessment_in.model_dump(exclude_unset=True)

    # Automatic status and marks rules
    if update_data.get("marks") is not None and "status" not in update_data and assessment.status == "pending":
        update_data["status"] = "scored"

    if update_data.get("status") in ("pending", "absent", "exempt"):
        update_data["marks"] = None

    # Verify combined resulting state consistency
    target_status = update_data.get("status", assessment.status)
    target_marks = update_data.get("marks", assessment.marks)
    target_max_marks = update_data.get("max_marks", assessment.max_marks)

    if target_status == "scored" and target_marks is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Marks are required when status is 'scored'"
        )
    if target_status in ("pending", "absent", "exempt") and target_marks is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"{target_status.capitalize()} assessments must not contain marks"
        )
    if target_marks is not None and target_max_marks is not None and target_marks > target_max_marks:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Marks cannot exceed max marks"
        )

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
