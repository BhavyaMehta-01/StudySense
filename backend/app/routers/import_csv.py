from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import csv
import io
from decimal import Decimal
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional

from .. import models
from ..dependencies import get_db, get_current_user

router = APIRouter(prefix="/import", tags=["import"])

class ImportError(BaseModel):
    row: int
    column: Optional[str]
    message: str

class ImportResponse(BaseModel):
    success: bool
    total_processed: int
    imported_records: int
    errors: List[ImportError]

def get_or_create_semester(db: Session, user_id: str, name: str) -> models.Semester:
    sem = db.query(models.Semester).filter_by(user_id=user_id, name=name).first()
    if not sem:
        sem = models.Semester(user_id=user_id, name=name, academic_year="Imported")
        db.add(sem)
        db.flush()
    return sem

def get_or_create_subject(db: Session, semester_id: str, name: str) -> models.Subject:
    sub = db.query(models.Subject).filter_by(semester_id=semester_id, name=name).first()
    if not sub:
        sub = models.Subject(semester_id=semester_id, name=name)
        db.add(sub)
        db.flush()
    return sub

@router.post("/csv", response_model=ImportResponse)
def import_csv(
    file: UploadFile = File(...),
    import_type: str = Form(...),  # 'academic' or 'attendance'
    dry_run: bool = Form(True),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    if import_type not in ["academic", "attendance"]:
        raise HTTPException(status_code=400, detail="Invalid import_type. Must be 'academic' or 'attendance'.")

    content = file.file.read().decode("utf-8")
    reader = csv.DictReader(io.StringIO(content))

    errors = []
    processed = 0
    imported = 0

    # We will use a savepoint to ensure we can roll back cleanly if dry_run=True or errors occur
    # Actually, SQLAlchemy 2.0 with Session can just rollback at the end if we don't commit.
    # We will only commit if not dry_run and no errors.

    # Cache to prevent N+1 queries during import
    semesters_cache = {}
    subjects_cache = {}

    def get_sem(name: str):
        if name not in semesters_cache:
            semesters_cache[name] = get_or_create_semester(db, current_user.id, name)
        return semesters_cache[name]

    def get_sub(sem_id: str, name: str):
        key = f"{sem_id}_{name}"
        if key not in subjects_cache:
            subjects_cache[key] = get_or_create_subject(db, sem_id, name)
        return subjects_cache[key]

    # Pre-check subject weightages to validate aggregate
    from sqlalchemy import func
    subject_weights = {}

    for row_num, row in enumerate(reader, start=2):
        processed += 1

        sem_name = row.get("semester")
        sub_name = row.get("subject")

        if not sem_name or not sub_name:
            errors.append(ImportError(row=row_num, column="semester/subject", message="Semester and subject are required"))
            continue

        sem = get_sem(sem_name)
        sub = get_sub(sem.id, sub_name)

        if import_type == "academic":
            ass_name = row.get("assessment")
            category = row.get("category")
            max_marks_str = row.get("max_marks")

            if not ass_name or not category or not max_marks_str:
                errors.append(ImportError(row=row_num, column="assessment/category/max_marks", message="Assessment, category, and max_marks are required"))
                continue

            try:
                max_marks = Decimal(max_marks_str)
                if max_marks <= 0:
                    raise ValueError
            except:
                errors.append(ImportError(row=row_num, column="max_marks", message="Invalid max_marks (must be > 0)"))
                continue

            marks = None
            if row.get("marks"):
                try:
                    marks = Decimal(row.get("marks"))
                    if marks < 0 or marks > max_marks:
                        raise ValueError
                except:
                    errors.append(ImportError(row=row_num, column="marks", message="Invalid marks (must be between 0 and max_marks)"))
                    continue

            weightage = None
            if row.get("weightage"):
                try:
                    weightage = Decimal(row.get("weightage"))
                    if weightage <= 0 or weightage > 100:
                        raise ValueError
                except:
                    errors.append(ImportError(row=row_num, column="weightage", message="Invalid weightage (must be > 0 and <= 100)"))
                    continue

            if weightage:
                if sub.id not in subject_weights:
                    current_w = db.query(func.sum(models.Assessment.weightage)).filter_by(subject_id=sub.id).scalar() or Decimal('0.0')
                    subject_weights[sub.id] = current_w

                if subject_weights[sub.id] + weightage > Decimal('100.0'):
                    errors.append(ImportError(row=row_num, column="weightage", message="Total subject weightage would exceed 100%"))
                    continue
                subject_weights[sub.id] += weightage

            scheduled_date = None
            if row.get("scheduled_date"):
                try:
                    # simplistic date parse
                    scheduled_date = datetime.strptime(row.get("scheduled_date"), "%Y-%m-%d")
                except:
                    errors.append(ImportError(row=row_num, column="scheduled_date", message="Invalid date format (use YYYY-MM-DD)"))
                    continue

            status = row.get("status") or "pending"
            valid_categories = ['internal_test', 'assignment', 'quiz', 'practical', 'viva', 'project', 'midsem', 'endsem', 'other']
            valid_statuses = ['pending', 'scored', 'absent', 'exempt']

            if category not in valid_categories:
                errors.append(ImportError(row=row_num, column="category", message=f"Invalid category. Must be one of {valid_categories}"))
                continue
            if status not in valid_statuses:
                errors.append(ImportError(row=row_num, column="status", message=f"Invalid status. Must be one of {valid_statuses}"))
                continue

            if status == "scored" and marks is None:
                errors.append(ImportError(row=row_num, column="marks", message="Marks are required when status is 'scored'"))
                continue

            # Check for duplicate assessment in this subject
            existing = db.query(models.Assessment).filter_by(subject_id=sub.id, name=ass_name).first()
            if existing:
                errors.append(ImportError(row=row_num, column="assessment", message="Assessment already exists"))
                continue

            ass = models.Assessment(
                subject_id=sub.id,
                name=ass_name,
                category=category,
                status=status,
                max_marks=max_marks,
                marks=marks,
                weightage=weightage,
                scheduled_at=scheduled_date
            )
            db.add(ass)
            imported += 1

        elif import_type == "attendance":
            try:
                att = int(row.get("classes_attended", 0))
                held = int(row.get("classes_held", 0))
                if att < 0 or held <= 0 or att > held:
                    raise ValueError
            except:
                errors.append(ImportError(row=row_num, column="classes", message="Invalid attendance values (attended >= 0, held > 0, attended <= held)"))
                continue

            rec_on = None
            if row.get("recorded_on"):
                try:
                    rec_on = datetime.strptime(row.get("recorded_on"), "%Y-%m-%d").date()
                except:
                    errors.append(ImportError(row=row_num, column="recorded_on", message="Invalid date format (use YYYY-MM-DD)"))
                    continue
            else:
                errors.append(ImportError(row=row_num, column="recorded_on", message="recorded_on is required"))
                continue

            attendance = models.Attendance(
                subject_id=sub.id,
                classes_attended=att,
                classes_held=held,
                recorded_on=rec_on
            )
            db.add(attendance)
            imported += 1

    # Commit or Rollback
    if dry_run or len(errors) > 0:
        db.rollback()
        success = False
    else:
        try:
            db.commit()
            success = True
        except IntegrityError:
            db.rollback()
            errors.append(ImportError(row=0, column="database", message="Database integrity error during commit"))
            success = False

    return ImportResponse(
        success=success,
        total_processed=processed,
        imported_records=imported if success else 0,
        errors=errors
    )
