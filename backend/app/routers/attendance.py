from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from uuid import UUID

from .. import schemas, models
from ..dependencies import get_db, get_current_user

router = APIRouter(prefix="/attendance", tags=["attendance"])

def get_attendance_or_404(db: Session, attendance_id: UUID, user_id: UUID) -> models.Attendance:
    # Join Attendance -> Subject -> Semester to verify user_id ownership
    attendance = db.query(models.Attendance).join(models.Subject).join(models.Semester).filter(
        models.Attendance.id == attendance_id,
        models.Semester.user_id == user_id
    ).first()
    if not attendance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance not found")
    return attendance

@router.get("/{attendance_id}", response_model=schemas.AttendanceResponse)
def get_attendance(
    attendance_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    return get_attendance_or_404(db, attendance_id, current_user.id)

@router.put("/{attendance_id}", response_model=schemas.AttendanceResponse)
def update_attendance(
    attendance_id: UUID,
    attendance_in: schemas.AttendanceUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    attendance = get_attendance_or_404(db, attendance_id, current_user.id)
    update_data = attendance_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(attendance, key, value)
    
    try:
        db.commit()
        db.refresh(attendance)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Database constraint violation")
    return attendance

@router.delete("/{attendance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attendance(
    attendance_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    attendance = get_attendance_or_404(db, attendance_id, current_user.id)
    db.delete(attendance)
    db.commit()
    return None
