from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
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

    # Duplicate name validation within same subject (case-insensitive, trimmed)
    from sqlalchemy import func
    normalized_name = assessment_in.name.strip()
    existing_assessment = db.query(models.Assessment).filter(
        models.Assessment.subject_id == subject.id,
        func.lower(func.trim(models.Assessment.name)) == normalized_name.lower()
    ).first()
    if existing_assessment:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An assessment with this name already exists in this subject"
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


# --- Assessment Pattern Endpoints (Stage 4.2.1a) ---

def get_pattern_or_404(db: Session, pattern_id: UUID, subject_id: UUID, user_id: UUID) -> models.AssessmentPattern:
    subject = get_subject_or_404(db, subject_id, user_id)
    pattern = db.query(models.AssessmentPattern).filter(
        models.AssessmentPattern.id == pattern_id,
        models.AssessmentPattern.subject_id == subject.id,
    ).first()
    if not pattern:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment pattern not found")
    return pattern


@router.get("/{subject_id}/pattern", response_model=Optional[schemas.AssessmentPatternResponse])
def get_subject_assessment_pattern(
    subject_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    subject = get_subject_or_404(db, subject_id, current_user.id)
    return db.query(models.AssessmentPattern).filter(
        models.AssessmentPattern.subject_id == subject.id,
        models.AssessmentPattern.is_active,
    ).first()


@router.post("/{subject_id}/pattern", response_model=schemas.AssessmentPatternResponse, status_code=status.HTTP_201_CREATED)
def create_subject_assessment_pattern(
    subject_id: UUID,
    pattern_in: schemas.AssessmentPatternCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    subject = get_subject_or_404(db, subject_id, current_user.id)
    if pattern_in.is_active:
        existing_active = db.query(models.AssessmentPattern).filter(
            models.AssessmentPattern.subject_id == subject.id,
            models.AssessmentPattern.is_active,
        ).first()
        if existing_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An active assessment pattern already exists for this subject"
            )

    pattern = models.AssessmentPattern(
        subject_id=subject.id,
        name=pattern_in.name,
        is_active=pattern_in.is_active,
    )
    db.add(pattern)

    try:
        db.flush()
        if pattern_in.components:
            for i, comp_in in enumerate(pattern_in.components):
                order_idx = comp_in.order_index if comp_in.order_index is not None else i
                component = models.AssessmentPatternComponent(
                    pattern_id=pattern.id,
                    name=comp_in.name,
                    category=comp_in.category,
                    max_marks=comp_in.max_marks,
                    weightage=comp_in.weightage,
                    is_active=comp_in.is_active,
                    order_index=order_idx,
                )
                db.add(component)
        db.commit()
        db.refresh(pattern)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active assessment pattern already exists for this subject"
        )
    except Exception:
        db.rollback()
        raise

    return pattern


@router.put("/{subject_id}/pattern/{pattern_id}", response_model=schemas.AssessmentPatternResponse)
def update_subject_assessment_pattern(
    subject_id: UUID,
    pattern_id: UUID,
    pattern_in: schemas.AssessmentPatternUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pattern = get_pattern_or_404(db, pattern_id, subject_id, current_user.id)
    update_data = pattern_in.model_dump(exclude_unset=True)

    if update_data.get("is_active") is True and not pattern.is_active:
        existing_active = db.query(models.AssessmentPattern).filter(
            models.AssessmentPattern.subject_id == subject_id,
            models.AssessmentPattern.is_active,
            models.AssessmentPattern.id != pattern.id,
        ).first()
        if existing_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Another active assessment pattern already exists for this subject"
            )

    for key, value in update_data.items():
        setattr(pattern, key, value)

    try:
        db.commit()
        db.refresh(pattern)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Another active assessment pattern already exists for this subject"
        )

    return pattern


@router.delete("/{subject_id}/pattern/{pattern_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subject_assessment_pattern(
    subject_id: UUID,
    pattern_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    pattern = get_pattern_or_404(db, pattern_id, subject_id, current_user.id)
    db.delete(pattern)
    db.commit()
    return None


# --- Assessment Pattern Component Endpoints (Stage 4.2.1b) ---

def get_component_or_404(
    db: Session,
    component_id: UUID,
    pattern_id: UUID,
    subject_id: UUID,
    user_id: UUID,
) -> models.AssessmentPatternComponent:
    pattern = get_pattern_or_404(db, pattern_id, subject_id, user_id)
    comp = db.query(models.AssessmentPatternComponent).filter(
        models.AssessmentPatternComponent.id == component_id,
        models.AssessmentPatternComponent.pattern_id == pattern.id,
    ).first()
    if not comp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment pattern component not found",
        )
    return comp


@router.post(
    "/{subject_id}/pattern/{pattern_id}/components",
    response_model=schemas.AssessmentPatternComponentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_pattern_component(
    subject_id: UUID,
    pattern_id: UUID,
    comp_in: schemas.AssessmentPatternComponentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    pattern = get_pattern_or_404(db, pattern_id, subject_id, current_user.id)

    if comp_in.is_active:
        active_weight = sum(c.weightage for c in pattern.components if c.is_active)
        if active_weight + comp_in.weightage > Decimal("100.00"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Total weightage of active components cannot exceed 100",
            )

    if "order_index" in comp_in.model_fields_set and comp_in.order_index is not None:
        order_idx = comp_in.order_index
    else:
        order_idx = max([c.order_index for c in pattern.components], default=-1) + 1

    component = models.AssessmentPatternComponent(
        pattern_id=pattern.id,
        name=comp_in.name,
        category=comp_in.category,
        max_marks=comp_in.max_marks,
        weightage=comp_in.weightage,
        is_active=comp_in.is_active,
        order_index=order_idx,
    )
    db.add(component)
    db.commit()
    db.refresh(component)
    return component


@router.put(
    "/{subject_id}/pattern/{pattern_id}/components/{component_id}",
    response_model=schemas.AssessmentPatternComponentResponse,
)
def update_pattern_component(
    subject_id: UUID,
    pattern_id: UUID,
    component_id: UUID,
    comp_in: schemas.AssessmentPatternComponentUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    component = get_component_or_404(db, component_id, pattern_id, subject_id, current_user.id)
    update_data = comp_in.model_dump(exclude_unset=True)

    # Merged-state evaluation before mutating ORM object
    target_active = update_data.get("is_active", component.is_active)
    target_weight = update_data.get("weightage", component.weightage)
    target_max_marks = update_data.get("max_marks", component.max_marks)

    if target_active and (target_weight is None or target_weight <= 0):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Active assessment pattern components must have weightage greater than 0",
        )

    if target_weight is not None:
        if target_weight < 0 or target_weight > 100:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Weightage must be between 0 and 100",
            )
        if target_weight % Decimal("0.5") != 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Weightage must be in increments of 0.5",
            )

    if target_max_marks is not None:
        if target_max_marks <= 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Max marks must be greater than 0",
            )
        if target_max_marks % Decimal("0.5") != 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Max marks must be in increments of 0.5",
            )

    if target_active:
        other_active_weight = sum(
            c.weightage
            for c in component.pattern.components
            if c.is_active and c.id != component.id
        )
        if other_active_weight + target_weight > Decimal("100.00"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Total weightage of active components cannot exceed 100",
            )

    # Apply updates only after all validations pass
    for key, value in update_data.items():
        setattr(component, key, value)

    db.commit()
    db.refresh(component)
    return component


@router.delete(
    "/{subject_id}/pattern/{pattern_id}/components/{component_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_pattern_component(
    subject_id: UUID,
    pattern_id: UUID,
    component_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    component = get_component_or_404(db, component_id, pattern_id, subject_id, current_user.id)
    db.delete(component)
    db.commit()
    return None
