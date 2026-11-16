from datetime import datetime, date, time, timezone
from decimal import Decimal
from typing import List, Optional, Union, Set
from uuid import UUID
import zoneinfo

from fastapi import APIRouter, Depends, HTTPException, Header, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import cast, Date, func
from sqlalchemy.exc import IntegrityError

from .. import models, schemas
from ..dependencies import get_db, get_current_user
from ..attendance_engine import (
    calculate_attendance_metrics,
    resolve_schedule,
    TimetableSlotData,
    CalendarEventData,
    OverrideData,
    AttendanceRecordData,
)

router = APIRouter(tags=["timetable"])


def get_user_semester(db: Session, semester_id: UUID, user_id: UUID) -> models.Semester:
    """Verify semester exists and belongs to the authenticated user."""
    semester = db.query(models.Semester).filter(
        models.Semester.id == semester_id,
        models.Semester.user_id == user_id
    ).first()
    if not semester:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Semester not found")
    return semester


def get_user_subject_in_semester(db: Session, subject_id: UUID, semester_id: UUID, user_id: UUID) -> models.Subject:
    """Verify subject exists, belongs to the semester, and belongs to the authenticated user."""
    subject = db.query(models.Subject).join(models.Semester).filter(
        models.Subject.id == subject_id,
        models.Semester.id == semester_id,
        models.Semester.user_id == user_id
    ).first()
    if not subject:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subject not found in this semester"
        )
    return subject


def get_user_today(user: models.User) -> date:
    """
    Safely determine the user's current local date on the server using their stored IANA timezone.
    Never trusts a client-supplied date header for security-critical future-date gating.
    Falls back to UTC date if timezone is invalid or unassigned.
    """
    tz_str = getattr(user, "timezone", None) or "UTC"
    try:
        tz = zoneinfo.ZoneInfo(tz_str)
    except Exception:
        tz = timezone.utc
    return datetime.now(tz).date()


# --- 1. Timetable Slots ---

@router.get("/semesters/{semester_id}/timetable", response_model=List[schemas.TimetableSlotResponse])
def list_timetable_slots(
    semester_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    get_user_semester(db, semester_id, current_user.id)
    return db.query(models.TimetableSlot).filter(
        models.TimetableSlot.semester_id == semester_id
    ).order_by(models.TimetableSlot.day_of_week, models.TimetableSlot.start_time).all()


@router.post("/semesters/{semester_id}/timetable", response_model=schemas.TimetableSlotResponse, status_code=status.HTTP_201_CREATED)
def create_timetable_slot(
    semester_id: UUID,
    slot_in: schemas.TimetableSlotCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    semester = get_user_semester(db, semester_id, current_user.id)
    get_user_subject_in_semester(db, slot_in.subject_id, semester_id, current_user.id)

    # Validate effective date ranges against semester boundaries
    if semester.start_date and slot_in.effective_to and slot_in.effective_to < semester.start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Slot effective_to cannot be before semester start_date"
        )
    if semester.end_date and slot_in.effective_from > semester.end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Slot effective_from cannot be after semester end_date"
        )

    # Detect conflicts for the same subject on the same day with overlapping time and effective date
    conflict_query = db.query(models.TimetableSlot).filter(
        models.TimetableSlot.semester_id == semester_id,
        models.TimetableSlot.subject_id == slot_in.subject_id,
        models.TimetableSlot.day_of_week == slot_in.day_of_week,
        models.TimetableSlot.start_time < slot_in.end_time,
        models.TimetableSlot.end_time > slot_in.start_time,
    )
    existing_slots = conflict_query.all()
    in_end = slot_in.effective_to or date.max
    for es in existing_slots:
        es_end = es.effective_to or date.max
        # Check date range overlap
        if es.effective_from <= in_end and es_end >= slot_in.effective_from:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A conflicting timetable slot exists for this subject at the specified time and day"
            )

    slot = models.TimetableSlot(**slot_in.model_dump(), semester_id=semester.id)
    db.add(slot)
    db.commit()
    db.refresh(slot)
    return slot


@router.put("/semesters/{semester_id}/timetable/{slot_id}", response_model=schemas.TimetableSlotResponse)
def update_timetable_slot(
    semester_id: UUID,
    slot_id: UUID,
    slot_in: schemas.TimetableSlotUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    semester = get_user_semester(db, semester_id, current_user.id)
    slot = db.query(models.TimetableSlot).filter(
        models.TimetableSlot.id == slot_id,
        models.TimetableSlot.semester_id == semester_id
    ).first()
    if not slot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Timetable slot not found")

    update_data = slot_in.model_dump(exclude_unset=True)

    target_dow = update_data.get("day_of_week", slot.day_of_week)
    target_start = update_data.get("start_time", slot.start_time)
    target_end = update_data.get("end_time", slot.end_time)
    target_eff_from = update_data.get("effective_from", slot.effective_from)
    target_eff_to = update_data.get("effective_to", slot.effective_to)

    if target_start >= target_end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_time must be before end_time")
    if target_eff_to and target_eff_from > target_eff_to:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="effective_from cannot be after effective_to")

    # Validate effective date ranges against semester boundaries
    if semester.start_date and target_eff_to and target_eff_to < semester.start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Slot effective_to cannot be before semester start_date"
        )
    if semester.end_date and target_eff_from > semester.end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Slot effective_from cannot be after semester end_date"
        )

    # Conflict check against other slots
    conflict_query = db.query(models.TimetableSlot).filter(
        models.TimetableSlot.semester_id == semester_id,
        models.TimetableSlot.subject_id == slot.subject_id,
        models.TimetableSlot.day_of_week == target_dow,
        models.TimetableSlot.id != slot_id,
        models.TimetableSlot.start_time < target_end,
        models.TimetableSlot.end_time > target_start,
    )
    in_end = target_eff_to or date.max
    for es in conflict_query.all():
        es_end = es.effective_to or date.max
        if es.effective_from <= in_end and es_end >= target_eff_from:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Update causes a conflict with another timetable slot"
            )

    for key, value in update_data.items():
        setattr(slot, key, value)
    db.commit()
    db.refresh(slot)
    return slot


@router.delete("/semesters/{semester_id}/timetable/{slot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_timetable_slot(
    semester_id: UUID,
    slot_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    get_user_semester(db, semester_id, current_user.id)
    slot = db.query(models.TimetableSlot).filter(
        models.TimetableSlot.id == slot_id,
        models.TimetableSlot.semester_id == semester_id
    ).first()
    if not slot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Timetable slot not found")

    db.delete(slot)
    db.commit()
    return None


# --- 2. Academic Calendar Events ---

def get_event_assessment_ids(db: Session, event: models.AcademicCalendarEvent) -> List[UUID]:
    direct_ids = [
        row[0] for row in db.query(models.Assessment.id).filter(
            models.Assessment.calendar_event_id == event.id
        ).all()
    ]
    sub_ids = [s.id for s in event.subjects]
    date_ids = []
    if event.event_type == "exam" and sub_ids:
        assessments = db.query(models.Assessment.id).filter(
            models.Assessment.subject_id.in_(sub_ids),
            models.Assessment.calendar_event_id.is_(None),
            models.Assessment.is_auto_generated.is_(False),
            cast(models.Assessment.scheduled_at, Date) >= event.start_date,
            cast(models.Assessment.scheduled_at, Date) <= event.end_date,
        ).all()
        date_ids = [a[0] for a in assessments]
    return list(dict.fromkeys(direct_ids + date_ids))


def resolve_assessment_name(
    db: Session,
    subject_id: UUID,
    base_title: str,
    component_name: str,
    start_date: date,
    event_id: UUID,
    current_assessment_id: Optional[UUID] = None
) -> str:
    base = f"{base_title.strip()} - {component_name.strip()}"
    candidates = [
        base,
        f"{base} ({start_date.isoformat()})",
        f"{base} ({str(event_id)[:8]})"
    ]
    for cand in candidates:
        q = db.query(models.Assessment).filter(
            models.Assessment.subject_id == subject_id,
            func.lower(func.trim(models.Assessment.name)) == cand.strip().lower()
        )
        if current_assessment_id:
            q = q.filter(models.Assessment.id != current_assessment_id)
        if not q.first():
            return cand
    return f"{base} ({str(event_id)})"


def validate_component_for_subject(
    db: Session,
    subject: models.Subject,
    component_id: UUID,
    event_id: Optional[UUID] = None,
) -> models.AssessmentPatternComponent:
    comp = db.query(models.AssessmentPatternComponent).filter(
        models.AssessmentPatternComponent.id == component_id
    ).first()
    if not comp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Assessment pattern component not found for subject '{subject.name}'"
        )
    pattern = db.query(models.AssessmentPattern).filter(
        models.AssessmentPattern.id == comp.pattern_id
    ).first()
    if not pattern or pattern.subject_id != subject.id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Component '{comp.name}' does not belong to subject '{subject.name}'"
        )
    if not pattern.is_active:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Assessment pattern for subject '{subject.name}' is inactive"
        )
    if not comp.is_active:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Component '{comp.name}' is inactive"
        )
    conflict_q = db.query(models.Assessment).filter(
        models.Assessment.pattern_component_id == comp.id,
        models.Assessment.calendar_event_id.isnot(None),
    )
    if event_id is not None:
        conflict_q = conflict_q.filter(models.Assessment.calendar_event_id != event_id)
    if conflict_q.first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Component '{comp.name}' is already linked to another calendar event"
        )
    return comp


def check_subject_weightage_cap(
    db: Session,
    subject_id: UUID,
    additional_weightage: Decimal,
    exclude_assessment_id: Optional[UUID] = None,
    exclude_assessment_ids: Optional[Union[List[UUID], Set[UUID]]] = None,
):
    q = db.query(func.sum(models.Assessment.weightage)).filter(
        models.Assessment.subject_id == subject_id
    )
    to_exclude = set()
    if exclude_assessment_id:
        to_exclude.add(exclude_assessment_id)
    if exclude_assessment_ids:
        to_exclude.update(exclude_assessment_ids)
    if to_exclude:
        q = q.filter(~models.Assessment.id.in_(to_exclude))
    current_total = q.scalar() or Decimal("0")
    if current_total + Decimal(str(additional_weightage)) > Decimal("100"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Total weightage for this subject would exceed 100%"
        )


@router.get("/semesters/{semester_id}/calendar", response_model=List[schemas.AcademicCalendarEventResponse])
def list_calendar_events(
    semester_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    get_user_semester(db, semester_id, current_user.id)
    events = db.query(models.AcademicCalendarEvent).filter(
        models.AcademicCalendarEvent.semester_id == semester_id
    ).order_by(models.AcademicCalendarEvent.start_date, models.AcademicCalendarEvent.title).all()

    response = []
    for ev in events:
        sub_ids = [s.id for s in ev.subjects]
        ass_ids = get_event_assessment_ids(db, ev)

        response.append(schemas.AcademicCalendarEventResponse(
            id=ev.id,
            semester_id=ev.semester_id,
            title=ev.title,
            event_type=ev.event_type,
            start_date=ev.start_date,
            end_date=ev.end_date,
            cancels_regular_classes=ev.cancels_regular_classes,
            subject_ids=sub_ids,
            assessment_ids=ass_ids,
            created_at=ev.created_at,
            updated_at=ev.updated_at,
        ))
    return response


@router.post("/semesters/{semester_id}/calendar", response_model=schemas.AcademicCalendarEventResponse, status_code=status.HTTP_201_CREATED)
def create_calendar_event(
    semester_id: UUID,
    event_in: schemas.AcademicCalendarEventCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    semester = get_user_semester(db, semester_id, current_user.id)

    if event_in.start_date > event_in.end_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_date cannot be after end_date")

    subjects = []
    subject_map = {}
    if event_in.event_type == "exam":
        if event_in.subject_components is not None:
            seen_subject_ids = set()
            for sc in event_in.subject_components:
                if sc.subject_id in seen_subject_ids:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail="Duplicate subject in subject_components"
                    )
                seen_subject_ids.add(sc.subject_id)

            if event_in.subject_ids and set(event_in.subject_ids) != seen_subject_ids:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Every selected subject must have an assessment pattern component selection"
                )

            for sid in seen_subject_ids:
                subj = get_user_subject_in_semester(db, sid, semester_id, current_user.id)
                subjects.append(subj)
                subject_map[sid] = subj

            for sc in event_in.subject_components:
                subj = subject_map[sc.subject_id]
                comp = validate_component_for_subject(db, subj, sc.pattern_component_id)

                detached = db.query(models.Assessment).filter(
                    models.Assessment.subject_id == subj.id,
                    models.Assessment.pattern_component_id == comp.id,
                    models.Assessment.calendar_event_id.is_(None)
                ).first()
                check_subject_weightage_cap(db, subj.id, comp.weightage, exclude_assessment_id=detached.id if detached else None)
        else:
            if event_in.subject_ids:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Every selected exam subject requires an explicit assessment pattern component selection"
                )
    else:
        if event_in.subject_ids:
            for sid in set(event_in.subject_ids):
                subj = get_user_subject_in_semester(db, sid, semester_id, current_user.id)
                subjects.append(subj)

    event_data = event_in.model_dump(exclude={"subject_ids", "subject_components"})
    event = models.AcademicCalendarEvent(**event_data, semester_id=semester.id)
    event.subjects = subjects

    try:
        db.add(event)
        db.flush()

        if event.event_type == "exam" and event_in.subject_components is not None:
            target_scheduled_at = datetime.combine(event.start_date, time(12, 0, 0), tzinfo=timezone.utc)
            for sc in event_in.subject_components:
                subj = subject_map[sc.subject_id]
                comp = db.get(models.AssessmentPatternComponent, sc.pattern_component_id)

                detached = db.query(models.Assessment).filter(
                    models.Assessment.subject_id == subj.id,
                    models.Assessment.pattern_component_id == comp.id,
                    models.Assessment.calendar_event_id.is_(None)
                ).first()

                if detached:
                    detached.calendar_event_id = event.id
                    if detached.status == "pending":
                        detached.scheduled_at = target_scheduled_at
                else:
                    name = resolve_assessment_name(db, subj.id, event.title, comp.name, event.start_date, event.id)
                    ass = models.Assessment(
                        subject_id=subj.id,
                        name=name,
                        category=comp.category,
                        max_marks=comp.max_marks,
                        weightage=comp.weightage,
                        scheduled_at=target_scheduled_at,
                        status="pending",
                        calendar_event_id=event.id,
                        pattern_component_id=comp.id,
                        is_auto_generated=True,
                    )
                    db.add(ass)

        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A component or assessment conflict occurred")
    except Exception:
        db.rollback()
        raise
    db.refresh(event)

    ass_ids = get_event_assessment_ids(db, event)

    return schemas.AcademicCalendarEventResponse(
        id=event.id,
        semester_id=event.semester_id,
        title=event.title,
        event_type=event.event_type,
        start_date=event.start_date,
        end_date=event.end_date,
        cancels_regular_classes=event.cancels_regular_classes,
        subject_ids=[s.id for s in event.subjects],
        assessment_ids=ass_ids,
        created_at=event.created_at,
        updated_at=event.updated_at,
    )


@router.put("/semesters/{semester_id}/calendar/{event_id}", response_model=schemas.AcademicCalendarEventResponse)
def update_calendar_event(
    semester_id: UUID,
    event_id: UUID,
    event_in: schemas.AcademicCalendarEventUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    get_user_semester(db, semester_id, current_user.id)
    event = db.query(models.AcademicCalendarEvent).filter(
        models.AcademicCalendarEvent.id == event_id,
        models.AcademicCalendarEvent.semester_id == semester_id
    ).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar event not found")

    update_data = event_in.model_dump(exclude_unset=True)

    target_start = update_data.get("start_date", event.start_date)
    target_end = update_data.get("end_date", event.end_date)
    if target_start > target_end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_date cannot be after end_date")

    target_scheduled_at = datetime.combine(target_start, time(12, 0, 0), tzinfo=timezone.utc)

    if event.event_type == "exam":
        if "subject_components" in update_data:
            sub_comps = update_data.pop("subject_components")
            if sub_comps is not None:
                seen_subject_ids = set()
                for sc in sub_comps:
                    if sc["subject_id"] in seen_subject_ids:
                        raise HTTPException(
                            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="Duplicate subject in subject_components"
                        )
                    seen_subject_ids.add(sc["subject_id"])

                if "subject_ids" in update_data:
                    passed_ids = set(update_data.pop("subject_ids"))
                    if passed_ids != seen_subject_ids:
                        raise HTTPException(
                            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="Every selected subject must have an assessment pattern component selection"
                        )

                new_subjects = [get_user_subject_in_semester(db, sid, semester_id, current_user.id) for sid in seen_subject_ids]
                new_subject_map = {s.id: s for s in new_subjects}

                existing_linked = db.query(models.Assessment).filter(
                    models.Assessment.calendar_event_id == event.id
                ).all()
                existing_by_subject = {a.subject_id: a for a in existing_linked}
                new_comp_by_subject = {sc["subject_id"]: sc["pattern_component_id"] for sc in sub_comps}

                # Phase 1: Validate all selections, components, replacements, and weightage caps before mutating state
                validated_comps = {}
                for sc in sub_comps:
                    sid = sc["subject_id"]
                    cid = sc["pattern_component_id"]
                    subj = new_subject_map[sid]
                    comp = validate_component_for_subject(db, subj, cid, event_id=event.id)
                    validated_comps[cid] = comp

                    if sid in existing_by_subject:
                        old_ass = existing_by_subject[sid]
                        if old_ass.pattern_component_id != cid:
                            if old_ass.status != "exempt":
                                raise HTTPException(
                                    status_code=status.HTTP_409_CONFLICT,
                                    detail=f"Cannot replace component for '{subj.name}' because an active assessment already exists. Exempt or delete it first."
                                )

                            detached = db.query(models.Assessment).filter(
                                models.Assessment.subject_id == sid,
                                models.Assessment.pattern_component_id == cid,
                                models.Assessment.calendar_event_id.is_(None)
                            ).first()

                            exclude_ids = {old_ass.id}
                            if detached:
                                exclude_ids.add(detached.id)
                            check_subject_weightage_cap(db, sid, comp.weightage, exclude_assessment_ids=exclude_ids)
                    else:
                        detached = db.query(models.Assessment).filter(
                            models.Assessment.subject_id == sid,
                            models.Assessment.pattern_component_id == cid,
                            models.Assessment.calendar_event_id.is_(None)
                        ).first()
                        check_subject_weightage_cap(db, sid, comp.weightage, exclude_assessment_id=detached.id if detached else None)

                # Phase 2: All validations passed; apply mutations
                for sid, old_ass in existing_by_subject.items():
                    if sid not in new_comp_by_subject:
                        old_ass.calendar_event_id = None

                for sc in sub_comps:
                    sid = sc["subject_id"]
                    cid = sc["pattern_component_id"]
                    comp = validated_comps[cid]

                    if sid in existing_by_subject:
                        old_ass = existing_by_subject[sid]
                        if old_ass.pattern_component_id != cid:
                            old_ass.calendar_event_id = None

                            detached = db.query(models.Assessment).filter(
                                models.Assessment.subject_id == sid,
                                models.Assessment.pattern_component_id == cid,
                                models.Assessment.calendar_event_id.is_(None)
                            ).first()

                            if detached:
                                detached.calendar_event_id = event.id
                                detached.scheduled_at = target_scheduled_at
                            else:
                                name = resolve_assessment_name(db, sid, update_data.get("title", event.title), comp.name, target_start, event.id)
                                new_ass = models.Assessment(
                                    subject_id=sid,
                                    name=name,
                                    category=comp.category,
                                    max_marks=comp.max_marks,
                                    weightage=comp.weightage,
                                    scheduled_at=target_scheduled_at,
                                    status="pending",
                                    calendar_event_id=event.id,
                                    pattern_component_id=cid,
                                    is_auto_generated=True,
                                )
                                db.add(new_ass)
                    else:
                        detached = db.query(models.Assessment).filter(
                            models.Assessment.subject_id == sid,
                            models.Assessment.pattern_component_id == cid,
                            models.Assessment.calendar_event_id.is_(None)
                        ).first()

                        if detached:
                            detached.calendar_event_id = event.id
                            detached.scheduled_at = target_scheduled_at
                        else:
                            name = resolve_assessment_name(db, sid, update_data.get("title", event.title), comp.name, target_start, event.id)
                            new_ass = models.Assessment(
                                subject_id=sid,
                                name=name,
                                category=comp.category,
                                max_marks=comp.max_marks,
                                weightage=comp.weightage,
                                scheduled_at=target_scheduled_at,
                                status="pending",
                                calendar_event_id=event.id,
                                pattern_component_id=cid,
                                is_auto_generated=True,
                            )
                            db.add(new_ass)

                event.subjects = new_subjects
        elif "subject_ids" in update_data:
            # Case A: subject_ids provided, subject_components omitted
            submitted_sids = set(update_data.pop("subject_ids"))
            for sid in submitted_sids:
                get_user_subject_in_semester(db, sid, semester_id, current_user.id)

            existing_sids = {s.id for s in event.subjects}
            newly_added = submitted_sids - existing_sids
            if newly_added:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Newly added exam subjects require an explicit assessment pattern component selection"
                )

            removed_sids = existing_sids - submitted_sids
            if removed_sids:
                linked_assessments = db.query(models.Assessment).filter(
                    models.Assessment.calendar_event_id == event.id
                ).all()
                for a in linked_assessments:
                    if a.subject_id in removed_sids:
                        a.calendar_event_id = None

            retained_sids = existing_sids & submitted_sids
            event.subjects = [s for s in event.subjects if s.id in retained_sids]
    else:
        # Non-exam event (Case D)
        if "subject_ids" in update_data:
            new_subjects = []
            for sid in set(update_data.pop("subject_ids")):
                subj = get_user_subject_in_semester(db, sid, semester_id, current_user.id)
                new_subjects.append(subj)
            event.subjects = new_subjects
        update_data.pop("subject_components", None)

    date_changed = "start_date" in update_data and update_data["start_date"] != event.start_date
    for key, value in update_data.items():
        setattr(event, key, value)

    # When date changes, update scheduled_at for all assessments still linked to this event (pending and scored)
    if date_changed:
        for a in event.assessments:
            if a.calendar_event_id == event.id:
                a.scheduled_at = target_scheduled_at

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A component or assessment conflict occurred")
    except Exception:
        db.rollback()
        raise
    db.refresh(event)

    ass_ids = get_event_assessment_ids(db, event)

    return schemas.AcademicCalendarEventResponse(
        id=event.id,
        semester_id=event.semester_id,
        title=event.title,
        event_type=event.event_type,
        start_date=event.start_date,
        end_date=event.end_date,
        cancels_regular_classes=event.cancels_regular_classes,
        subject_ids=[s.id for s in event.subjects],
        assessment_ids=ass_ids,
        created_at=event.created_at,
        updated_at=event.updated_at,
    )


@router.delete("/semesters/{semester_id}/calendar/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_calendar_event(
    semester_id: UUID,
    event_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    get_user_semester(db, semester_id, current_user.id)
    event = db.query(models.AcademicCalendarEvent).filter(
        models.AcademicCalendarEvent.id == event_id,
        models.AcademicCalendarEvent.semester_id == semester_id
    ).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar event not found")

    db.delete(event)
    db.commit()
    return None


# --- 3. Timetable Overrides ---

@router.get("/semesters/{semester_id}/overrides", response_model=List[schemas.TimetableOverrideResponse])
def list_overrides(
    semester_id: UUID,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    get_user_semester(db, semester_id, current_user.id)
    query = db.query(models.TimetableOverride).filter(
        models.TimetableOverride.semester_id == semester_id
    )
    if from_date:
        query = query.filter(models.TimetableOverride.target_date >= from_date)
    if to_date:
        query = query.filter(models.TimetableOverride.target_date <= to_date)
    return query.order_by(models.TimetableOverride.target_date, models.TimetableOverride.start_time).all()


@router.post("/semesters/{semester_id}/overrides", response_model=schemas.TimetableOverrideResponse, status_code=status.HTTP_201_CREATED)
def create_override(
    semester_id: UUID,
    override_in: schemas.TimetableOverrideCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    semester = get_user_semester(db, semester_id, current_user.id)
    get_user_subject_in_semester(db, override_in.subject_id, semester_id, current_user.id)

    if override_in.timetable_slot_id:
        slot = db.query(models.TimetableSlot).filter(
            models.TimetableSlot.id == override_in.timetable_slot_id,
            models.TimetableSlot.semester_id == semester_id
        ).first()
        if not slot:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Timetable slot not found in this semester")
        if slot.subject_id != override_in.subject_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Referenced timetable slot does not belong to the specified subject"
            )

    # Validate semester boundaries
    if semester.start_date and override_in.target_date < semester.start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="target_date is before semester start_date")
    if semester.end_date and override_in.target_date > semester.end_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="target_date is after semester end_date")
    if override_in.original_date:
        if semester.start_date and override_in.original_date < semester.start_date:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="original_date is before semester start_date")
        if semester.end_date and override_in.original_date > semester.end_date:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="original_date is after semester end_date")

    # Conflict check
    if override_in.override_type == "cancelled":
        existing = db.query(models.TimetableOverride).filter(
            models.TimetableOverride.semester_id == semester_id,
            models.TimetableOverride.subject_id == override_in.subject_id,
            models.TimetableOverride.target_date == override_in.target_date,
            models.TimetableOverride.start_time == override_in.start_time,
            models.TimetableOverride.override_type == "cancelled"
        ).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lecture is already cancelled on this date and time")
    elif override_in.override_type == "rescheduled":
        existing = db.query(models.TimetableOverride).filter(
            models.TimetableOverride.semester_id == semester_id,
            models.TimetableOverride.subject_id == override_in.subject_id,
            models.TimetableOverride.original_date == override_in.original_date,
            models.TimetableOverride.start_time == override_in.start_time,
            models.TimetableOverride.override_type == "rescheduled"
        ).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lecture on original_date has already been rescheduled")
        target_clash = db.query(models.TimetableOverride).filter(
            models.TimetableOverride.semester_id == semester_id,
            models.TimetableOverride.subject_id == override_in.subject_id,
            models.TimetableOverride.target_date == override_in.target_date,
            models.TimetableOverride.start_time < override_in.end_time,
            models.TimetableOverride.end_time > override_in.start_time,
            models.TimetableOverride.override_type.in_(("rescheduled", "extra"))
        ).first()
        if target_clash:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A lecture already exists for this subject at the rescheduled target date and time")
    elif override_in.override_type == "extra":
        existing = db.query(models.TimetableOverride).filter(
            models.TimetableOverride.semester_id == semester_id,
            models.TimetableOverride.subject_id == override_in.subject_id,
            models.TimetableOverride.target_date == override_in.target_date,
            models.TimetableOverride.start_time < override_in.end_time,
            models.TimetableOverride.end_time > override_in.start_time,
            models.TimetableOverride.override_type == "extra"
        ).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="An extra lecture already exists at this time")

        resched_clash = db.query(models.TimetableOverride).filter(
            models.TimetableOverride.semester_id == semester_id,
            models.TimetableOverride.subject_id == override_in.subject_id,
            models.TimetableOverride.target_date == override_in.target_date,
            models.TimetableOverride.start_time < override_in.end_time,
            models.TimetableOverride.end_time > override_in.start_time,
            models.TimetableOverride.override_type == "rescheduled"
        ).first()
        if resched_clash:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A rescheduled lecture already exists for this subject at this time")

        target_dow = override_in.target_date.weekday()
        slot_clash = db.query(models.TimetableSlot).filter(
            models.TimetableSlot.semester_id == semester_id,
            models.TimetableSlot.subject_id == override_in.subject_id,
            models.TimetableSlot.day_of_week == target_dow,
            models.TimetableSlot.start_time < override_in.end_time,
            models.TimetableSlot.end_time > override_in.start_time,
            models.TimetableSlot.effective_from <= override_in.target_date,
            (models.TimetableSlot.effective_to.is_(None) | (models.TimetableSlot.effective_to >= override_in.target_date))
        ).first()
        if slot_clash:
            cancelled_away = db.query(models.TimetableOverride).filter(
                models.TimetableOverride.semester_id == semester_id,
                models.TimetableOverride.subject_id == override_in.subject_id,
                models.TimetableOverride.start_time == slot_clash.start_time,
                (
                    (models.TimetableOverride.override_type == "cancelled") &
                    (models.TimetableOverride.target_date == override_in.target_date)
                ) | (
                    (models.TimetableOverride.override_type == "rescheduled") &
                    (models.TimetableOverride.original_date == override_in.target_date)
                )
            ).first()
            if not cancelled_away:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="An active regular lecture already exists for this subject at this time"
                )

    override = models.TimetableOverride(**override_in.model_dump(), semester_id=semester.id)
    db.add(override)
    db.commit()
    db.refresh(override)
    return override


@router.delete("/semesters/{semester_id}/overrides/{override_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_override(
    semester_id: UUID,
    override_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    get_user_semester(db, semester_id, current_user.id)
    override = db.query(models.TimetableOverride).filter(
        models.TimetableOverride.id == override_id,
        models.TimetableOverride.semester_id == semester_id
    ).first()
    if not override:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Override not found")

    db.delete(override)
    db.commit()
    return None


# --- 4. Resolved Lecture Schedule ---

@router.get("/semesters/{semester_id}/lectures", response_model=List[schemas.LectureOccurrenceResponse])
def get_scheduled_lectures(
    semester_id: UUID,
    from_date: date = Query(..., description="Start date of requested range"),
    to_date: date = Query(..., description="End date of requested range"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    semester = get_user_semester(db, semester_id, current_user.id)
    if from_date > to_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="from_date cannot be after to_date")
    if (to_date - from_date).days > 366:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Requested range cannot exceed 366 days")

    slots_db = db.query(models.TimetableSlot).filter(models.TimetableSlot.semester_id == semester_id).all()
    events_db = db.query(models.AcademicCalendarEvent).filter(models.AcademicCalendarEvent.semester_id == semester_id).all()
    overrides_db = db.query(models.TimetableOverride).filter(models.TimetableOverride.semester_id == semester_id).all()
    attendances_db = db.query(models.LectureAttendance).filter(
        models.LectureAttendance.semester_id == semester_id,
        models.LectureAttendance.lecture_date >= from_date,
        models.LectureAttendance.lecture_date <= to_date
    ).all()

    # Convert to pure dataclasses
    slots_data = [
        TimetableSlotData(
            id=s.id,
            subject_id=s.subject_id,
            day_of_week=s.day_of_week,
            start_time=s.start_time,
            end_time=s.end_time,
            effective_from=s.effective_from,
            effective_to=s.effective_to,
        ) for s in slots_db
    ]

    events_data = [
        CalendarEventData(
            id=e.id,
            title=e.title,
            event_type=e.event_type,
            start_date=e.start_date,
            end_date=e.end_date,
            cancels_regular_classes=e.cancels_regular_classes,
            subject_ids={s.id for s in e.subjects},
        ) for e in events_db
    ]

    overrides_data = [
        OverrideData(
            id=o.id,
            subject_id=o.subject_id,
            override_type=o.override_type,
            target_date=o.target_date,
            start_time=o.start_time,
            end_time=o.end_time,
            original_date=o.original_date,
            timetable_slot_id=o.timetable_slot_id,
            note=o.note,
        ) for o in overrides_db
    ]

    attendances_data = [
        AttendanceRecordData(
            id=a.id,
            subject_id=a.subject_id,
            lecture_date=a.lecture_date,
            start_time=a.start_time,
            end_time=a.end_time,
            status=a.status,
            timetable_slot_id=a.timetable_slot_id,
            override_id=a.override_id,
        ) for a in attendances_db
    ]

    occurrences = resolve_schedule(
        from_date=from_date,
        to_date=to_date,
        semester_start_date=semester.start_date,
        semester_end_date=semester.end_date,
        slots=slots_data,
        calendar_events=events_data,
        overrides=overrides_data,
        attendances=attendances_data,
    )

    subjects_map = {s.id: (s.name, s.code) for s in semester.subjects}

    return [
        schemas.LectureOccurrenceResponse(
            lecture_date=oc.lecture_date,
            start_time=oc.start_time,
            end_time=oc.end_time,
            subject_id=oc.subject_id,
            subject_name=subjects_map.get(oc.subject_id, (None, None))[0],
            subject_code=subjects_map.get(oc.subject_id, (None, None))[1],
            occurrence_type=oc.occurrence_type,
            is_cancelled=oc.is_cancelled,
            cancellation_reason=oc.cancellation_reason,
            timetable_slot_id=oc.timetable_slot_id,
            override_id=oc.override_id,
            attendance_id=oc.attendance_id,
            attendance_status=oc.attendance_status,
        ) for oc in occurrences
    ]


# --- 5. Individual Lecture Attendance ---

@router.post("/semesters/{semester_id}/lectures/attendance", response_model=schemas.LectureAttendanceResponse)
def record_lecture_attendance(
    semester_id: UUID,
    att_in: schemas.LectureAttendanceCreate,
    x_client_date: Optional[date] = Header(None, alias="X-Client-Date"),
    x_client_timezone: Optional[str] = Header(None, alias="X-Client-Timezone"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    semester = get_user_semester(db, semester_id, current_user.id)
    get_user_subject_in_semester(db, att_in.subject_id, semester_id, current_user.id)

    # 1. Future-date check based strictly on user's server-computed date (SEC-01)
    user_today = get_user_today(current_user)
    if att_in.lecture_date > user_today:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Attendance cannot be recorded for future dates"
        )

    # 2. Validate foreign references (SEC-02)
    if att_in.timetable_slot_id:
        slot = db.query(models.TimetableSlot).filter(
            models.TimetableSlot.id == att_in.timetable_slot_id,
            models.TimetableSlot.semester_id == semester_id,
            models.TimetableSlot.subject_id == att_in.subject_id
        ).first()
        if not slot:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Referenced timetable slot not found for this subject and semester"
            )

    if att_in.override_id:
        ov = db.query(models.TimetableOverride).filter(
            models.TimetableOverride.id == att_in.override_id,
            models.TimetableOverride.semester_id == semester_id,
            models.TimetableOverride.subject_id == att_in.subject_id
        ).first()
        if not ov:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Referenced timetable override not found for this subject and semester"
            )

    # 3. Check for existing attendance record (to distinguish new vs correction)
    existing = db.query(models.LectureAttendance).filter(
        models.LectureAttendance.subject_id == att_in.subject_id,
        models.LectureAttendance.lecture_date == att_in.lecture_date,
        models.LectureAttendance.start_time == att_in.start_time
    ).first()

    # 4. Check whether this lecture occurrence is cancelled (INT-01)
    cancelled_ov = db.query(models.TimetableOverride).filter(
        models.TimetableOverride.semester_id == semester_id,
        models.TimetableOverride.subject_id == att_in.subject_id,
        models.TimetableOverride.target_date == att_in.lecture_date,
        models.TimetableOverride.start_time == att_in.start_time,
        models.TimetableOverride.override_type == "cancelled"
    ).first()

    rescheduled_away = db.query(models.TimetableOverride).filter(
        models.TimetableOverride.semester_id == semester_id,
        models.TimetableOverride.subject_id == att_in.subject_id,
        models.TimetableOverride.original_date == att_in.lecture_date,
        models.TimetableOverride.start_time == att_in.start_time,
        models.TimetableOverride.override_type == "rescheduled"
    ).first()

    cal_events = db.query(models.AcademicCalendarEvent).filter(
        models.AcademicCalendarEvent.semester_id == semester_id,
        models.AcademicCalendarEvent.start_date <= att_in.lecture_date,
        models.AcademicCalendarEvent.end_date >= att_in.lecture_date,
        models.AcademicCalendarEvent.cancels_regular_classes == True
    ).all()
    is_holiday = any(
        (not ev.subjects or any(s.id == att_in.subject_id for s in ev.subjects))
        for ev in cal_events
    )

    # Identify whether the requested occurrence corresponds to an extra lecture override
    extra_override = None
    if att_in.override_id:
        extra_override = db.query(models.TimetableOverride).filter(
            models.TimetableOverride.id == att_in.override_id,
            models.TimetableOverride.semester_id == semester_id,
            models.TimetableOverride.subject_id == att_in.subject_id,
            models.TimetableOverride.override_type == "extra"
        ).first()
    if not extra_override:
        extra_override = db.query(models.TimetableOverride).filter(
            models.TimetableOverride.semester_id == semester_id,
            models.TimetableOverride.subject_id == att_in.subject_id,
            models.TimetableOverride.target_date == att_in.lecture_date,
            models.TimetableOverride.start_time == att_in.start_time,
            models.TimetableOverride.override_type == "extra"
        ).first()

    # Academic calendar events cancel regular slots, not explicit extra lecture overrides.
    # Explicit cancellation overrides take precedence over extra lectures.
    is_cancelled = bool(cancelled_ov or rescheduled_away or (is_holiday and not extra_override))

    if is_cancelled and att_in.status in ("attended", "missed"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot mark lecture as attended or missed because it was cancelled"
        )

    # 5. For NEW records, verify a scheduled lecture occurrence exists (INT-01)
    if not existing:
        has_override = db.query(models.TimetableOverride).filter(
            models.TimetableOverride.semester_id == semester_id,
            models.TimetableOverride.subject_id == att_in.subject_id,
            models.TimetableOverride.target_date == att_in.lecture_date,
            models.TimetableOverride.start_time == att_in.start_time
        ).first()

        weekday = att_in.lecture_date.weekday()
        slot_query = db.query(models.TimetableSlot).filter(
            models.TimetableSlot.semester_id == semester_id,
            models.TimetableSlot.subject_id == att_in.subject_id,
            models.TimetableSlot.day_of_week == weekday,
            models.TimetableSlot.start_time == att_in.start_time,
            models.TimetableSlot.effective_from <= att_in.lecture_date,
            (models.TimetableSlot.effective_to.is_(None) | (models.TimetableSlot.effective_to >= att_in.lecture_date))
        )
        if semester.start_date:
            slot_query = slot_query.filter(att_in.lecture_date >= semester.start_date)
        if semester.end_date:
            slot_query = slot_query.filter(att_in.lecture_date <= semester.end_date)
        has_slot = slot_query.first()

        if not has_override and not has_slot:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No scheduled lecture found for this subject at the specified date and time"
            )

    # 6. Upsert with concurrency safety (CORR-04)
    if existing:
        existing.status = att_in.status
        existing.end_time = att_in.end_time
        if att_in.timetable_slot_id:
            existing.timetable_slot_id = att_in.timetable_slot_id
        if att_in.override_id:
            existing.override_id = att_in.override_id
        existing.updated_at = datetime.now(timezone.utc)
        record = existing
    else:
        record = models.LectureAttendance(**att_in.model_dump(), semester_id=semester.id)
        db.add(record)

    try:
        db.commit()
        db.refresh(record)
    except IntegrityError:
        db.rollback()
        # Recover from concurrency race
        existing = db.query(models.LectureAttendance).filter(
            models.LectureAttendance.subject_id == att_in.subject_id,
            models.LectureAttendance.lecture_date == att_in.lecture_date,
            models.LectureAttendance.start_time == att_in.start_time
        ).first()
        if existing:
            existing.status = att_in.status
            existing.end_time = att_in.end_time
            if att_in.timetable_slot_id:
                existing.timetable_slot_id = att_in.timetable_slot_id
            if att_in.override_id:
                existing.override_id = att_in.override_id
            existing.updated_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(existing)
            record = existing
        else:
            raise

    return record


@router.get("/semesters/{semester_id}/lectures/attendance", response_model=List[schemas.LectureAttendanceResponse])
def list_lecture_attendances(
    semester_id: UUID,
    subject_id: Optional[UUID] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    get_user_semester(db, semester_id, current_user.id)
    query = db.query(models.LectureAttendance).filter(
        models.LectureAttendance.semester_id == semester_id
    )
    if subject_id:
        get_user_subject_in_semester(db, subject_id, semester_id, current_user.id)
        query = query.filter(models.LectureAttendance.subject_id == subject_id)
    if from_date:
        query = query.filter(models.LectureAttendance.lecture_date >= from_date)
    if to_date:
        query = query.filter(models.LectureAttendance.lecture_date <= to_date)

    return query.order_by(models.LectureAttendance.lecture_date.desc(), models.LectureAttendance.start_time.desc()).all()


@router.delete("/semesters/{semester_id}/lectures/attendance/{attendance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lecture_attendance(
    semester_id: UUID,
    attendance_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    get_user_semester(db, semester_id, current_user.id)
    att = db.query(models.LectureAttendance).filter(
        models.LectureAttendance.id == attendance_id,
        models.LectureAttendance.semester_id == semester_id
    ).first()
    if not att:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found")

    db.delete(att)
    db.commit()
    return None


# --- 6. Subject Attendance Summary ---

@router.get("/subjects/{subject_id}/attendance-summary", response_model=schemas.AttendanceMetricsResponse)
def get_subject_attendance_summary(
    subject_id: UUID,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    subject = db.query(models.Subject).join(models.Semester).filter(
        models.Subject.id == subject_id,
        models.Semester.user_id == current_user.id
    ).first()
    if not subject:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subject not found")

    records = db.query(models.LectureAttendance).filter(
        models.LectureAttendance.subject_id == subject.id
    ).all()

    attended = sum(1 for r in records if r.status == "attended")
    missed = sum(1 for r in records if r.status == "missed")
    cancelled = sum(1 for r in records if r.status == "class_cancelled")
    target = subject.attendance_target_percentage

    metrics = calculate_attendance_metrics(
        attended=attended,
        missed=missed,
        target_percentage=target,
        cancelled=cancelled
    )

    return schemas.AttendanceMetricsResponse(
        attended=metrics.attended,
        missed=metrics.missed,
        held=metrics.held,
        cancelled=metrics.cancelled,
        target_percentage=metrics.target_percentage,
        percentage=metrics.percentage,
        is_at_or_above_target=metrics.is_at_or_above_target,
        classes_to_attend=metrics.classes_to_attend,
        classes_can_miss=metrics.classes_can_miss,
        impossible_to_reach_target=metrics.impossible_to_reach_target,
    )

