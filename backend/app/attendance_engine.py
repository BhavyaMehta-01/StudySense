"""
Pure business logic for timetable-driven attendance calculations and schedule resolution.
Zero side-effects, zero database dependencies, 100% testable in isolation.
"""
from dataclasses import dataclass, field
from datetime import date, time, timedelta
from decimal import Decimal
from typing import Optional, Set, List, Dict, Tuple
from uuid import UUID


@dataclass(frozen=True)
class AttendanceMetrics:
    attended: int
    missed: int
    held: int
    cancelled: int
    target_percentage: int
    percentage: Optional[Decimal]
    is_at_or_above_target: bool
    classes_to_attend: Optional[int]
    classes_can_miss: Optional[int]
    impossible_to_reach_target: bool


def calculate_attendance_metrics(
    attended: int,
    missed: int,
    target_percentage: int,
    cancelled: int = 0
) -> AttendanceMetrics:
    """
    Calculate attendance percentage and margin/consecutive recovery lectures using exact integer math.

    Definitions:
    - A = attended lectures
    - M = missed lectures
    - H = A + M (held)
    - Cancelled lectures do not count towards H.
    - T = target_percentage (0 to 100).
    """
    if attended < 0 or missed < 0 or cancelled < 0:
        raise ValueError("Attendance counts cannot be negative")
    if not (0 <= target_percentage <= 100):
        raise ValueError("Target percentage must be between 0 and 100")

    held = attended + missed

    # Percentage: Decimal rounded to 2 decimal places if held > 0, else None
    if held > 0:
        pct = (Decimal(attended) * Decimal(100) / Decimal(held)).quantize(Decimal("0.01"))
    else:
        pct = None

    # Threshold condition: 100 * A >= T * H
    # When held == 0: 100*0 >= T*0 (0 >= 0) is True, meaning no deficit exists yet.
    is_at_or_above = (100 * attended) >= (target_percentage * held)

    if is_at_or_above:
        # At or above target
        classes_to_attend = 0
        impossible = False
        if target_percentage == 0:
            classes_can_miss = None  # Can miss infinite classes without falling below 0%
        else:
            # y = floor((100*A - T*H) / T)
            classes_can_miss = (100 * attended - target_percentage * held) // target_percentage
    else:
        # Below target
        classes_can_miss = 0
        if target_percentage == 100:
            # If missed > 0, mathematically impossible to ever reach 100%
            impossible = True
            classes_to_attend = None
        else:
            impossible = False
            # x = ceil((T*H - 100*A) / (100 - T))
            # In integer arithmetic: (N + D - 1) // D
            numerator = target_percentage * held - 100 * attended
            denominator = 100 - target_percentage
            classes_to_attend = (numerator + denominator - 1) // denominator

    return AttendanceMetrics(
        attended=attended,
        missed=missed,
        held=held,
        cancelled=cancelled,
        target_percentage=target_percentage,
        percentage=pct,
        is_at_or_above_target=is_at_or_above,
        classes_to_attend=classes_to_attend,
        classes_can_miss=classes_can_miss,
        impossible_to_reach_target=impossible,
    )


@dataclass(frozen=True)
class TimetableSlotData:
    id: UUID
    subject_id: UUID
    day_of_week: int  # 0 = Monday .. 6 = Sunday
    start_time: time
    end_time: time
    effective_from: date
    effective_to: Optional[date] = None


@dataclass(frozen=True)
class CalendarEventData:
    id: UUID
    title: str
    event_type: str  # 'holiday', 'non_working_day', 'exam'
    start_date: date
    end_date: date
    cancels_regular_classes: bool = True
    subject_ids: Set[UUID] = field(default_factory=set)


@dataclass(frozen=True)
class OverrideData:
    id: UUID
    subject_id: UUID
    override_type: str  # 'cancelled', 'extra', 'rescheduled'
    target_date: date
    start_time: time
    end_time: time
    original_date: Optional[date] = None
    timetable_slot_id: Optional[UUID] = None
    note: Optional[str] = None


@dataclass(frozen=True)
class AttendanceRecordData:
    id: UUID
    subject_id: UUID
    lecture_date: date
    start_time: time
    end_time: time
    status: str  # 'attended', 'missed', 'class_cancelled'
    timetable_slot_id: Optional[UUID] = None
    override_id: Optional[UUID] = None


@dataclass(frozen=True)
class LectureOccurrence:
    lecture_date: date
    start_time: time
    end_time: time
    subject_id: UUID
    occurrence_type: str  # 'regular', 'extra', 'rescheduled', 'historical'
    is_cancelled: bool
    cancellation_reason: Optional[str] = None
    timetable_slot_id: Optional[UUID] = None
    override_id: Optional[UUID] = None
    attendance_id: Optional[UUID] = None
    attendance_status: Optional[str] = None  # 'attended', 'missed', 'class_cancelled', or None


def resolve_schedule(
    from_date: date,
    to_date: date,
    semester_start_date: Optional[date] = None,
    semester_end_date: Optional[date] = None,
    slots: Optional[List[TimetableSlotData]] = None,
    calendar_events: Optional[List[CalendarEventData]] = None,
    overrides: Optional[List[OverrideData]] = None,
    attendances: Optional[List[AttendanceRecordData]] = None,
) -> List[LectureOccurrence]:
    """
    Resolve scheduled lecture occurrences for a requested date range [from_date, to_date].

    - Expands weekly recurring slots clipped to semester bounds [start_date, end_date].
    - Respects each slot's [effective_from, effective_to] range.
    - Suppresses regular lectures on holidays/non-working days (or calendar events cancelling regular classes).
    - Respects exam calendar events and their affected subjects.
    - Applies date-specific overrides (cancelled, extra, rescheduled).
    - Preserves historical attendance records even if the timetable slot has since been changed or removed.
    """
    if from_date > to_date:
        return []

    slots = slots or []
    calendar_events = calendar_events or []
    overrides = overrides or []
    attendances = attendances or []

    # Map attendance records for rapid matching
    override_att_map: Dict[UUID, AttendanceRecordData] = {}
    slot_date_att_map: Dict[Tuple[UUID, date], AttendanceRecordData] = {}
    subject_time_att_map: Dict[Tuple[UUID, date, time], AttendanceRecordData] = {}

    for att in attendances:
        if att.override_id:
            override_att_map[att.override_id] = att
        if att.timetable_slot_id:
            slot_date_att_map[(att.timetable_slot_id, att.lecture_date)] = att
        subject_time_att_map[(att.subject_id, att.lecture_date, att.start_time)] = att

    consumed_attendance_ids: Set[UUID] = set()
    occurrences: List[LectureOccurrence] = []

    # Clip recurring slots to semester bounds if provided
    window_start = from_date
    if semester_start_date:
        window_start = max(window_start, semester_start_date)

    window_end = to_date
    if semester_end_date:
        window_end = min(window_end, semester_end_date)

    # 1. Expand recurring slots within active semester window
    if window_start <= window_end:
        current_date = window_start
        one_day = timedelta(days=1)

        while current_date <= window_end:
            weekday = current_date.weekday()

            # Find active calendar events for current_date
            day_events = [
                ev for ev in calendar_events
                if ev.start_date <= current_date <= ev.end_date
            ]

            # Collect overrides for current_date
            target_overrides = [ov for ov in overrides if ov.target_date == current_date]
            cancelled_overrides = [ov for ov in target_overrides if ov.override_type == "cancelled"]

            # Rescheduled overrides originating on current_date
            rescheduled_away = [
                ov for ov in overrides
                if ov.override_type == "rescheduled" and ov.original_date == current_date
            ]

            # Slots matching this weekday and effective date range
            active_slots = [
                s for s in slots
                if s.day_of_week == weekday
                and s.effective_from <= current_date
                and (s.effective_to is None or current_date <= s.effective_to)
            ]

            for slot in active_slots:
                # Check if rescheduled away from this date
                resched = next(
                    (ov for ov in rescheduled_away
                     if ov.timetable_slot_id == slot.id or
                     (ov.subject_id == slot.subject_id and ov.start_time == slot.start_time)),
                    None
                )
                if resched:
                    # Regular slot was rescheduled to another date
                    is_cancelled = True
                    reason = resched.note or f"Rescheduled to {resched.target_date}"
                else:
                    # Check if cancelled by date-specific override
                    canc_ov = next(
                        (ov for ov in cancelled_overrides
                         if ov.timetable_slot_id == slot.id or
                         (ov.subject_id == slot.subject_id and ov.start_time == slot.start_time)),
                        None
                    )
                    if canc_ov:
                        is_cancelled = True
                        reason = canc_ov.note or "Lecture cancelled by instructor"
                    else:
                        # Check calendar events (holidays, non-working days, exams)
                        cancelling_event = next(
                            (ev for ev in day_events
                             if ev.cancels_regular_classes and (
                                 not ev.subject_ids or slot.subject_id in ev.subject_ids
                             )),
                            None
                        )
                        if cancelling_event:
                            is_cancelled = True
                            reason = cancelling_event.title
                        else:
                            is_cancelled = False
                            reason = None

                # Check for recorded attendance
                att = (
                    slot_date_att_map.get((slot.id, current_date)) or
                    subject_time_att_map.get((slot.subject_id, current_date, slot.start_time))
                )
                att_id = None
                att_status = None
                if att:
                    att_id = att.id
                    att_status = att.status
                    consumed_attendance_ids.add(att.id)

                occurrences.append(LectureOccurrence(
                    lecture_date=current_date,
                    start_time=slot.start_time,
                    end_time=slot.end_time,
                    subject_id=slot.subject_id,
                    occurrence_type="regular",
                    is_cancelled=is_cancelled,
                    cancellation_reason=reason,
                    timetable_slot_id=slot.id,
                    override_id=None,
                    attendance_id=att_id,
                    attendance_status=att_status,
                ))

            # 2. Add extra and rescheduled lectures targeting current_date
            for ov in target_overrides:
                if ov.override_type in ("extra", "rescheduled"):
                    att = (
                        override_att_map.get(ov.id) or
                        subject_time_att_map.get((ov.subject_id, current_date, ov.start_time))
                    )
                    att_id = None
                    att_status = None
                    if att:
                        att_id = att.id
                        att_status = att.status
                        consumed_attendance_ids.add(att.id)

                    occurrences.append(LectureOccurrence(
                        lecture_date=current_date,
                        start_time=ov.start_time,
                        end_time=ov.end_time,
                        subject_id=ov.subject_id,
                        occurrence_type=ov.override_type,
                        is_cancelled=False,
                        cancellation_reason=ov.note,
                        timetable_slot_id=ov.timetable_slot_id,
                        override_id=ov.id,
                        attendance_id=att_id,
                        attendance_status=att_status,
                    ))

            current_date += one_day

    # 3. Preserve historical attendance records independently of later timetable changes
    # Any attendance record within [from_date, to_date] that wasn't already matched to an occurrence
    for att in attendances:
        if from_date <= att.lecture_date <= to_date and att.id not in consumed_attendance_ids:
            occurrences.append(LectureOccurrence(
                lecture_date=att.lecture_date,
                start_time=att.start_time,
                end_time=att.end_time,
                subject_id=att.subject_id,
                occurrence_type="historical",
                is_cancelled=(att.status == "class_cancelled"),
                cancellation_reason="Historical attendance record",
                timetable_slot_id=att.timetable_slot_id,
                override_id=att.override_id,
                attendance_id=att.id,
                attendance_status=att.status,
            ))
            consumed_attendance_ids.add(att.id)

    # Sort deterministically by date, start_time, subject_id
    occurrences.sort(key=lambda oc: (oc.lecture_date, oc.start_time, oc.subject_id))
    return occurrences

