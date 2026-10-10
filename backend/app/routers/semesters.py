from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List
from uuid import UUID

from .. import schemas, models
from ..dependencies import get_db, get_current_user

router = APIRouter(prefix="/semesters", tags=["semesters"])

@router.post("", response_model=schemas.SemesterResponse)
def create_semester(
    semester_in: schemas.SemesterCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    semester = models.Semester(**semester_in.model_dump(), user_id=current_user.id)
    db.add(semester)
    db.commit()
    db.refresh(semester)
    return semester

@router.get("", response_model=List[schemas.SemesterResponse])
def list_semesters(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    return db.query(models.Semester).filter(models.Semester.user_id == current_user.id).all()

def get_semester_or_404(db: Session, semester_id: UUID, user_id: UUID) -> models.Semester:
    semester = db.query(models.Semester).filter(
        models.Semester.id == semester_id,
        models.Semester.user_id == user_id
    ).first()
    if not semester:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Semester not found")
    return semester

@router.get("/{semester_id}", response_model=schemas.SemesterResponse)
def get_semester(
    semester_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    return get_semester_or_404(db, semester_id, current_user.id)

@router.put("/{semester_id}", response_model=schemas.SemesterResponse)
def update_semester(
    semester_id: UUID,
    semester_in: schemas.SemesterUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    semester = get_semester_or_404(db, semester_id, current_user.id)
    update_data = semester_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(semester, key, value)
    db.commit()
    db.refresh(semester)
    return semester

@router.delete("/{semester_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_semester(
    semester_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    semester = get_semester_or_404(db, semester_id, current_user.id)
    db.delete(semester)
    db.commit()
    return None

@router.patch("/{semester_id}/activate", response_model=schemas.SemesterResponse)
def activate_semester(
    semester_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Lock the user row to serialize concurrent activation requests for the same user
    db.query(models.User).filter(models.User.id == current_user.id).with_for_update().first()

    # Verify the requested semester belongs to the user
    semester = get_semester_or_404(db, semester_id, current_user.id)

    # If already active, just return it
    if semester.is_active:
        return semester

    # Deactivate the currently active semester for this user (if any)
    active_semester = db.query(models.Semester).filter(
        models.Semester.user_id == current_user.id,
        models.Semester.is_active == True
    ).first()

    if active_semester:
        active_semester.is_active = False
        db.add(active_semester)

    # Flush the transaction to ensure the old active semester is deactivated
    # before we activate the new one, avoiding unique constraint violation
    db.flush()

    # Activate the requested semester
    semester.is_active = True
    db.add(semester)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not activate semester due to a conflict. Please try again."
        )

    db.refresh(semester)
    return semester

@router.post("/{semester_id}/subjects", response_model=schemas.SubjectResponse)
def create_subject(
    semester_id: UUID,
    subject_in: schemas.SubjectCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    semester = get_semester_or_404(db, semester_id, current_user.id)
    subject = models.Subject(**subject_in.model_dump(), semester_id=semester.id)
    db.add(subject)
    db.commit()
    db.refresh(subject)
    return subject

@router.get("/{semester_id}/subjects", response_model=List[schemas.SubjectResponse])
def list_subjects(
    semester_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    semester = get_semester_or_404(db, semester_id, current_user.id)
    return db.query(models.Subject).filter(models.Subject.semester_id == semester.id).all()

