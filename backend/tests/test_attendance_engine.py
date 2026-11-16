from datetime import date, time
from decimal import Decimal
import uuid
import pytest

from app.attendance_engine import (
    calculate_attendance_metrics,
    resolve_schedule,
    TimetableSlotData,
    CalendarEventData,
    OverrideData,
    AttendanceRecordData,
)


class TestAttendanceMetricsCalculation:
    def test_zero_classes_held_default_target(self):
        metrics = calculate_attendance_metrics(attended=0, missed=0, target_percentage=75)
        assert metrics.held == 0
        assert metrics.percentage is None
        assert metrics.is_at_or_above_target is True
        assert metrics.classes_to_attend == 0
        assert metrics.classes_can_miss == 0
        assert metrics.impossible_to_reach_target is False

    def test_zero_classes_held_zero_target(self):
        metrics = calculate_attendance_metrics(attended=0, missed=0, target_percentage=0)
        assert metrics.held == 0
        assert metrics.percentage is None
        assert metrics.is_at_or_above_target is True
        assert metrics.classes_to_attend == 0
        assert metrics.classes_can_miss is None
        assert metrics.impossible_to_reach_target is False

    def test_zero_classes_held_hundred_target(self):
        metrics = calculate_attendance_metrics(attended=0, missed=0, target_percentage=100)
        assert metrics.held == 0
        assert metrics.percentage is None
        assert metrics.is_at_or_above_target is True
        assert metrics.classes_to_attend == 0
        assert metrics.classes_can_miss == 0
        assert metrics.impossible_to_reach_target is False

    def test_at_target_exactly(self):
        # 3 attended, 1 missed = 75%
        metrics = calculate_attendance_metrics(attended=3, missed=1, target_percentage=75)
        assert metrics.held == 4
        assert metrics.percentage == Decimal("75.00")
        assert metrics.is_at_or_above_target is True
        assert metrics.classes_to_attend == 0
        assert metrics.classes_can_miss == 0
        assert metrics.impossible_to_reach_target is False

    def test_above_target_can_miss_calculation(self):
        # 10 attended, 0 missed = 100%
        # Target 75%
        # 100 * 10 - 75 * 10 = 1000 - 750 = 250
        # 250 // 75 = 3
        # If misses 3: 10/13 = 76.92% >= 75%
        # If misses 4: 10/14 = 71.43% < 75%
        metrics = calculate_attendance_metrics(attended=10, missed=0, target_percentage=75)
        assert metrics.held == 10
        assert metrics.percentage == Decimal("100.00")
        assert metrics.is_at_or_above_target is True
        assert metrics.classes_to_attend == 0
        assert metrics.classes_can_miss == 3

    def test_above_target_zero_percent_can_miss_infinite(self):
        # Target is 0%: can miss infinite classes
        metrics = calculate_attendance_metrics(attended=2, missed=2, target_percentage=0)
        assert metrics.held == 4
        assert metrics.is_at_or_above_target is True
        assert metrics.classes_to_attend == 0
        assert metrics.classes_can_miss is None

    def test_below_target_consecutive_needed_ceiling(self):
        # 1 attended, 3 missed = 25% < 75%
        # Target 75%
        # Numerator: 75*4 - 100*1 = 300 - 100 = 200
        # Denominator: 100 - 75 = 25
        # (200 + 25 - 1) // 25 = 8
        # Attending 8: 9/12 = 75.0%
        # Attending 7: 8/11 = 72.7%
        metrics = calculate_attendance_metrics(attended=1, missed=3, target_percentage=75)
        assert metrics.held == 4
        assert metrics.percentage == Decimal("25.00")
        assert metrics.is_at_or_above_target is False
        assert metrics.classes_to_attend == 8
        assert metrics.classes_can_miss == 0
        assert metrics.impossible_to_reach_target is False

    def test_below_target_ceiling_fractional_case(self):
        # 4 attended, 2 missed = 4/6 = 66.67%
        # Target 80%
        # Numerator: 80*6 - 100*4 = 480 - 400 = 80
        # Denominator: 100 - 80 = 20
        # 80 // 20 = 4
        # Check: 8/10 = 80.0%
        metrics = calculate_attendance_metrics(attended=4, missed=2, target_percentage=80)
        assert metrics.held == 6
        assert metrics.is_at_or_above_target is False
        assert metrics.classes_to_attend == 4

        # Now test fractional ceiling: 4 attended, 3 missed = 4/7 = 57.14%
        # Target 80%
        # Numerator: 80*7 - 100*4 = 560 - 400 = 160
        # Denominator: 20
        # 160 // 20 = 8
        # Check: (4+8)/(7+8) = 12/15 = 80%
        metrics2 = calculate_attendance_metrics(attended=4, missed=3, target_percentage=80)
        assert metrics2.classes_to_attend == 8

        # 4 attended, 3 missed, target 75%
        # Numerator: 75*7 - 100*4 = 525 - 400 = 125
        # Denominator: 25
        # 125 // 25 = 5
        # Check: (4+5)/(7+5) = 9/12 = 75%
        metrics3 = calculate_attendance_metrics(attended=4, missed=3, target_percentage=75)
        assert metrics3.classes_to_attend == 5

    def test_target_100_percent_with_missed_lecture_is_impossible(self):
        # Target 100%, 10 attended, 1 missed
        metrics = calculate_attendance_metrics(attended=10, missed=1, target_percentage=100)
        assert metrics.is_at_or_above_target is False
        assert metrics.impossible_to_reach_target is True
        assert metrics.classes_to_attend is None
        assert metrics.classes_can_miss == 0

    def test_cancelled_lectures_do_not_affect_held_count(self):
        metrics = calculate_attendance_metrics(attended=5, missed=1, target_percentage=75, cancelled=4)
        assert metrics.held == 6
        assert metrics.cancelled == 4
        assert metrics.percentage == Decimal("83.33")

    def test_validation_errors(self):
        with pytest.raises(ValueError, match="Attendance counts cannot be negative"):
            calculate_attendance_metrics(attended=-1, missed=0, target_percentage=75)

        with pytest.raises(ValueError, match="Target percentage must be between 0 and 100"):
            calculate_attendance_metrics(attended=1, missed=0, target_percentage=101)


class TestTimetableResolution:
    def test_weekly_recurring_expansion_within_semester_dates(self):
        subj_id = uuid.uuid4()
        # Monday = 0
        slot = TimetableSlotData(
            id=uuid.uuid4(),
            subject_id=subj_id,
            day_of_week=0,
            start_time=time(9, 0),
            end_time=time(10, 0),
            effective_from=date(2026, 9, 1),
        )

        # Semester is from 2026-09-07 (Mon) to 2026-09-21 (Mon)
        occurrences = resolve_schedule(
            from_date=date(2026, 9, 1),
            to_date=date(2026, 9, 30),
            semester_start_date=date(2026, 9, 7),
            semester_end_date=date(2026, 9, 21),
            slots=[slot],
        )

        # Mondays in range [2026-09-07, 2026-09-21]: Sept 7, Sept 14, Sept 21 (3 lectures)
        dates = [oc.lecture_date for oc in occurrences]
        assert dates == [date(2026, 9, 7), date(2026, 9, 14), date(2026, 9, 21)]
        assert all(not oc.is_cancelled for oc in occurrences)
        assert all(oc.occurrence_type == "regular" for oc in occurrences)

    def test_respects_slot_effective_dates(self):
        subj_id = uuid.uuid4()
        # Monday slot effective only from Sept 14 to Sept 20
        slot = TimetableSlotData(
            id=uuid.uuid4(),
            subject_id=subj_id,
            day_of_week=0,
            start_time=time(9, 0),
            end_time=time(10, 0),
            effective_from=date(2026, 9, 14),
            effective_to=date(2026, 9, 20),
        )

        occurrences = resolve_schedule(
            from_date=date(2026, 9, 1),
            to_date=date(2026, 9, 30),
            semester_start_date=date(2026, 9, 1),
            semester_end_date=date(2026, 9, 30),
            slots=[slot],
        )

        # Sept 7 is before effective_from; Sept 21 is after effective_to; only Sept 14 should exist
        dates = [oc.lecture_date for oc in occurrences]
        assert dates == [date(2026, 9, 14)]

    def test_holiday_suppresses_regular_lectures(self):
        subj_id = uuid.uuid4()
        slot = TimetableSlotData(
            id=uuid.uuid4(),
            subject_id=subj_id,
            day_of_week=0,
            start_time=time(9, 0),
            end_time=time(10, 0),
            effective_from=date(2026, 9, 1),
        )
        holiday = CalendarEventData(
            id=uuid.uuid4(),
            title="Labor Day",
            event_type="holiday",
            start_date=date(2026, 9, 7),
            end_date=date(2026, 9, 7),
            cancels_regular_classes=True,
        )

        occurrences = resolve_schedule(
            from_date=date(2026, 9, 7),
            to_date=date(2026, 9, 14),
            slots=[slot],
            calendar_events=[holiday],
        )

        assert len(occurrences) == 2
        sept_7 = occurrences[0]
        assert sept_7.lecture_date == date(2026, 9, 7)
        assert sept_7.is_cancelled is True
        assert sept_7.cancellation_reason == "Labor Day"

        sept_14 = occurrences[1]
        assert sept_14.lecture_date == date(2026, 9, 14)
        assert sept_14.is_cancelled is False

    def test_date_specific_cancelled_override(self):
        subj_id = uuid.uuid4()
        slot_id = uuid.uuid4()
        slot = TimetableSlotData(
            id=slot_id,
            subject_id=subj_id,
            day_of_week=0,
            start_time=time(10, 0),
            end_time=time(11, 0),
            effective_from=date(2026, 9, 1),
        )
        override = OverrideData(
            id=uuid.uuid4(),
            subject_id=subj_id,
            override_type="cancelled",
            timetable_slot_id=slot_id,
            target_date=date(2026, 9, 7),
            start_time=time(10, 0),
            end_time=time(11, 0),
            note="Teacher unwell",
        )

        occurrences = resolve_schedule(
            from_date=date(2026, 9, 7),
            to_date=date(2026, 9, 7),
            slots=[slot],
            overrides=[override],
        )

        assert len(occurrences) == 1
        assert occurrences[0].is_cancelled is True
        assert occurrences[0].cancellation_reason == "Teacher unwell"

    def test_extra_and_rescheduled_overrides(self):
        subj_id = uuid.uuid4()
        slot_id = uuid.uuid4()
        slot = TimetableSlotData(
            id=slot_id,
            subject_id=subj_id,
            day_of_week=0,
            start_time=time(9, 0),
            end_time=time(10, 0),
            effective_from=date(2026, 9, 1),
        )
        # Reschedule Sept 7 lecture to Tuesday Sept 8
        resched_override = OverrideData(
            id=uuid.uuid4(),
            subject_id=subj_id,
            override_type="rescheduled",
            timetable_slot_id=slot_id,
            original_date=date(2026, 9, 7),
            target_date=date(2026, 9, 8),
            start_time=time(14, 0),
            end_time=time(15, 0),
            note="Moved to Tuesday afternoon",
        )
        # Extra lecture on Wednesday Sept 9
        extra_override = OverrideData(
            id=uuid.uuid4(),
            subject_id=subj_id,
            override_type="extra",
            target_date=date(2026, 9, 9),
            start_time=time(11, 0),
            end_time=time(12, 0),
            note="Review session",
        )

        occurrences = resolve_schedule(
            from_date=date(2026, 9, 7),
            to_date=date(2026, 9, 9),
            slots=[slot],
            overrides=[resched_override, extra_override],
        )

        # Expect:
        # Sept 7: regular slot marked cancelled/rescheduled
        # Sept 8: rescheduled lecture
        # Sept 9: extra lecture
        assert len(occurrences) == 3
        assert occurrences[0].lecture_date == date(2026, 9, 7)
        assert occurrences[0].is_cancelled is True
        assert occurrences[0].cancellation_reason == "Moved to Tuesday afternoon"

        assert occurrences[1].lecture_date == date(2026, 9, 8)
        assert occurrences[1].occurrence_type == "rescheduled"
        assert occurrences[1].is_cancelled is False

        assert occurrences[2].lecture_date == date(2026, 9, 9)
        assert occurrences[2].occurrence_type == "extra"
        assert occurrences[2].is_cancelled is False

    def test_preserves_historical_attendance_records_when_timetable_changes(self):
        subj_id = uuid.uuid4()
        old_att_id = uuid.uuid4()
        # An attendance record exists on a date/time where no active slot currently exists
        hist_attendance = AttendanceRecordData(
            id=old_att_id,
            subject_id=subj_id,
            lecture_date=date(2026, 9, 2),  # Wednesday
            start_time=time(8, 0),
            end_time=time(9, 0),
            status="attended",
            timetable_slot_id=None,
        )

        occurrences = resolve_schedule(
            from_date=date(2026, 9, 1),
            to_date=date(2026, 9, 5),
            slots=[],  # Slot was deleted!
            attendances=[hist_attendance],
        )

        assert len(occurrences) == 1
        assert occurrences[0].lecture_date == date(2026, 9, 2)
        assert occurrences[0].occurrence_type == "historical"
        assert occurrences[0].attendance_id == old_att_id
        assert occurrences[0].attendance_status == "attended"

    def test_exam_event_with_subject_ids_cancels_only_affected_subject(self):
        subj1 = uuid.uuid4()
        subj2 = uuid.uuid4()
        slot1 = TimetableSlotData(
            id=uuid.uuid4(),
            subject_id=subj1,
            day_of_week=0,
            start_time=time(9, 0),
            end_time=time(10, 0),
            effective_from=date(2026, 9, 1),
        )
        slot2 = TimetableSlotData(
            id=uuid.uuid4(),
            subject_id=subj2,
            day_of_week=0,
            start_time=time(10, 0),
            end_time=time(11, 0),
            effective_from=date(2026, 9, 1),
        )
        exam = CalendarEventData(
            id=uuid.uuid4(),
            title="Midterm Exam Subj 1",
            event_type="exam",
            start_date=date(2026, 9, 7),
            end_date=date(2026, 9, 7),
            cancels_regular_classes=True,
            subject_ids={subj1},
        )

        occurrences = resolve_schedule(
            from_date=date(2026, 9, 7),
            to_date=date(2026, 9, 7),
            slots=[slot1, slot2],
            calendar_events=[exam],
        )

        assert len(occurrences) == 2
        # slot1 is cancelled because of the exam for subj1
        assert occurrences[0].subject_id == subj1
        assert occurrences[0].is_cancelled is True
        assert occurrences[0].cancellation_reason == "Midterm Exam Subj 1"

        # slot2 is not affected
        assert occurrences[1].subject_id == subj2
        assert occurrences[1].is_cancelled is False

