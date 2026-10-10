from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
from uuid import UUID

from .. import models, schemas
from ..dependencies import get_db, get_current_user

router = APIRouter(prefix="/study-sessions", tags=["study-sessions"])

@router.post("", response_model=schemas.StudySessionResponse)
def create_study_session(
    session_in: schemas.StudySessionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    allocation = db.query(models.StudyPlanAllocation).join(models.StudyPlan).filter(
        models.StudyPlanAllocation.id == session_in.allocation_id,
        models.StudyPlan.user_id == current_user.id
    ).first()
    
    if not allocation:
        raise HTTPException(status_code=404, detail="Allocation not found")
        
    plan = allocation.plan
    if session_in.date < plan.start_date or session_in.date > plan.end_date:
        raise HTTPException(status_code=400, detail="Date must be within the StudyPlan period")

    db_session = models.StudySession(
        allocation_id=session_in.allocation_id,
        user_id=current_user.id,
        date=session_in.date,
        duration_minutes=session_in.duration_minutes,
        status=session_in.status
    )
    db.add(db_session)
    try:
        db.commit()
        db.refresh(db_session)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Invalid data")
        
    return db_session

@router.get("", response_model=List[schemas.StudySessionResponse])
def get_study_sessions(
    plan_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    query = db.query(models.StudySession).filter(models.StudySession.user_id == current_user.id)
    
    if plan_id:
        query = query.join(
            models.StudyPlanAllocation, 
            models.StudySession.allocation_id == models.StudyPlanAllocation.id
        ).filter(
            models.StudyPlanAllocation.plan_id == plan_id
        )
        
    query = query.order_by(
        models.StudySession.date.desc(),
        models.StudySession.created_at.desc(),
        models.StudySession.id.desc()
    )
    
    return query.all()
