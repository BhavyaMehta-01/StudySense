from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import date
from typing import List

from .. import schemas, models
from ..dependencies import get_db, get_current_user
from ..allocation_engine import (
    calculate_allocations, EngineInput, EngineSubject, EngineAssessment
)

router = APIRouter(prefix="/study-plans", tags=["study-plans"])

@router.post("", response_model=schemas.StudyPlanResponse)
def create_study_plan(
    plan_in: schemas.StudyPlanCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    # Lock the user row to prevent concurrent plan creation
    db.query(models.User).filter(models.User.id == current_user.id).with_for_update().first()

    # 1. Check if an active plan already exists
    existing_active_plan = db.query(models.StudyPlan).filter(
        models.StudyPlan.user_id == current_user.id,
        models.StudyPlan.is_active == True
    ).first()

    if existing_active_plan:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User already has an active study plan. Cannot create a new one without deactivating or rebalancing."
        )

    # 2. Derive active semester
    active_semester = db.query(models.Semester).filter(
        models.Semester.user_id == current_user.id,
        models.Semester.is_active == True
    ).first()

    if not active_semester:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User has no active semester. Cannot create a study plan."
        )

    # 3. Collect subjects and assessments
    subjects = db.query(models.Subject).filter(models.Subject.semester_id == active_semester.id).all()

    engine_subjects = []
    for subject in subjects:
        # Load assessments for this subject
        assessments = db.query(models.Assessment).filter(models.Assessment.subject_id == subject.id).all()

        engine_assessments = []
        for ass in assessments:
            engine_assessments.append(EngineAssessment(
                status=ass.status,
                marks=ass.marks,
                max_marks=ass.max_marks,
                weightage=ass.weightage if ass.weightage else 0, # weightage is nullable, engine needs Decimal but defaults if None? Wait, EngineAssessment expects Decimal, but we need to ensure no None.
                scheduled_at=ass.scheduled_at
            ))

        engine_subjects.append(EngineSubject(
            subject_id=str(subject.id),
            name=subject.name,
            target_percentage=subject.target_percentage,
            assessments=engine_assessments
        ))

    # 4. Engine calculation
    engine_input = EngineInput(
        available_minutes=plan_in.available_minutes,
        current_date=date.today(),
        subjects=engine_subjects
    )

    allocations_result = calculate_allocations(engine_input)

    if not allocations_result:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No eligible subjects or assessments found in the active semester to allocate time to."
        )

    total_allocated = sum(r.allocated_minutes for r in allocations_result)
    if total_allocated != plan_in.available_minutes:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Allocation engine generated invalid total minutes."
        )

    # 5. Persist Plan and Allocations
    new_plan = models.StudyPlan(
        user_id=current_user.id,
        start_date=plan_in.start_date,
        end_date=plan_in.end_date,
        available_minutes=plan_in.available_minutes,
        is_active=True
    )
    db.add(new_plan)
    db.flush() # flush to get plan ID

    for alloc in allocations_result:
        new_alloc = models.StudyPlanAllocation(
            plan_id=new_plan.id,
            subject_id=alloc.subject_id, # This is UUID string, sqlalchemy accepts string or UUID
            allocated_minutes=alloc.allocated_minutes,
            snapshot_state=alloc.snapshot_state.model_dump(),
            explanation_code=alloc.explanation_code
        )
        db.add(new_alloc)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Integrity error during study plan creation."
        )

    db.refresh(new_plan)
    return new_plan
