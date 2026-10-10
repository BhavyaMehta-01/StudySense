from datetime import date, timedelta
from decimal import Decimal
import pytest

from app.allocation_engine import (
    EngineAssessment,
    EngineSubject,
    EngineInput,
    calculate_allocations,
)

def test_no_eligible_subjects():
    engine_input = EngineInput(
        available_minutes=60,
        current_date=date(2026, 1, 1),
        subjects=[
            EngineSubject(
                subject_id="s1",
                name="Math",
                assessments=[
                    EngineAssessment(status="scored", max_marks=Decimal('100'), marks=Decimal('90'), weightage=Decimal('100'))
                ]
            )
        ]
    )
    result = calculate_allocations(engine_input)
    assert len(result) == 0

def test_one_eligible_subject():
    engine_input = EngineInput(
        available_minutes=60,
        current_date=date(2026, 1, 1),
        subjects=[
            EngineSubject(
                subject_id="s1",
                name="Math",
                assessments=[
                    EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('100'), scheduled_at=date(2026, 1, 5))
                ]
            )
        ]
    )
    result = calculate_allocations(engine_input)
    assert len(result) == 1
    assert result[0].subject_id == "s1"
    assert result[0].allocated_minutes == 60
    assert result[0].snapshot_state.primary_driver == "URGENCY"

def test_urgency_values():
    curr = date(2026, 1, 1)
    # Check D=0, 1, 3, 7, 14, 21
    offsets = [0, 1, 3, 7, 14, 21]
    expected_U = [1.0, max(0.0, 1.0 - 1/14.0), max(0.0, 1.0 - 3/14.0), 0.5, 0.0, 0.0]

    for offset, exp in zip(offsets, expected_U):
        engine_input = EngineInput(
            available_minutes=60,
            current_date=curr,
            subjects=[
                EngineSubject(
                    subject_id="s1",
                    name="Math",
                    assessments=[
                        EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('100'), scheduled_at=curr + timedelta(days=offset))
                    ]
                )
            ]
        )
        res = calculate_allocations(engine_input)
        assert abs(res[0].snapshot_state.raw_factors["urgency"] - exp) < 1e-5

def test_target_deficit():
    # current_percentage = 50%, target = 80% -> P = 0.3
    # current = 90%, target = 80% -> P = 0.0
    # current = 50%, target = None -> P = 0.0

    subjects = [
        EngineSubject(
            subject_id="s1",
            name="S1",
            target_percentage=80,
            assessments=[
                EngineAssessment(status="scored", max_marks=Decimal('100'), marks=Decimal('50'), weightage=Decimal('50')),
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('50'), scheduled_at=date(2026, 1, 5))
            ]
        ),
        EngineSubject(
            subject_id="s2",
            name="S2",
            target_percentage=80,
            assessments=[
                EngineAssessment(status="scored", max_marks=Decimal('100'), marks=Decimal('90'), weightage=Decimal('50')),
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('50'), scheduled_at=date(2026, 1, 5))
            ]
        ),
        EngineSubject(
            subject_id="s3",
            name="S3",
            target_percentage=None,
            assessments=[
                EngineAssessment(status="scored", max_marks=Decimal('100'), marks=Decimal('50'), weightage=Decimal('50')),
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('50'), scheduled_at=date(2026, 1, 5))
            ]
        )
    ]

    engine_input = EngineInput(available_minutes=120, current_date=date(2026, 1, 1), subjects=subjects)
    res = calculate_allocations(engine_input)

    # Sort by subject_id to easily check
    res_dict = {r.subject_id: r for r in res}

    assert abs(res_dict["s1"].snapshot_state.raw_factors["deficit"] - 0.3) < 1e-5
    assert abs(res_dict["s2"].snapshot_state.raw_factors["deficit"] - 0.0) < 1e-5
    assert abs(res_dict["s3"].snapshot_state.raw_factors["deficit"] - 0.0) < 1e-5

def test_60_percent_cap_and_redistribution():
    # 3 subjects. 1 has U=1, P=1, W=1 -> raw=1.0. Others have U=0, P=0, W=0.01 -> raw=0.002
    # Before cap, S1 gets ~99%. Cap limits S1 to 60%.
    # S2 and S3 split the remaining 40%.
    subjects = [
        EngineSubject(
            subject_id="s1",
            name="S1",
            target_percentage=100,
            assessments=[
                EngineAssessment(status="scored", max_marks=Decimal('100'), marks=Decimal('0'), weightage=Decimal('50')),
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('50'), scheduled_at=date(2026, 1, 1))
            ]
        ),
        EngineSubject(
            subject_id="s2",
            name="S2",
            target_percentage=0,
            assessments=[
                EngineAssessment(status="scored", max_marks=Decimal('100'), marks=Decimal('100'), weightage=Decimal('50')),
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('50'), scheduled_at=date(2026, 1, 15)) # U=0
            ]
        ),
        EngineSubject(
            subject_id="s3",
            name="S3",
            target_percentage=0,
            assessments=[
                EngineAssessment(status="scored", max_marks=Decimal('100'), marks=Decimal('100'), weightage=Decimal('50')),
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('50'), scheduled_at=date(2026, 1, 15)) # U=0
            ]
        )
    ]

    engine_input = EngineInput(available_minutes=100, current_date=date(2026, 1, 1), subjects=subjects)
    res = calculate_allocations(engine_input)

    res_dict = {r.subject_id: r for r in res}

    assert res_dict["s1"].allocated_minutes == 60
    assert res_dict["s2"].allocated_minutes == 20
    assert res_dict["s3"].allocated_minutes == 20

    assert sum(r.allocated_minutes for r in res) == 100

def test_all_zero_baseline():
    subjects = [
        EngineSubject(
            subject_id="s1",
            name="S1",
            assessments=[
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('50'), scheduled_at=date(2026, 1, 20)) # U=0
            ]
        ),
        EngineSubject(
            subject_id="s2",
            name="S2",
            assessments=[
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('50'), scheduled_at=date(2026, 1, 20)) # U=0
            ]
        )
    ]
    # W=1 because it's the only remaining, so raw > 0? Wait, W = upcoming/remaining = 50/50 = 1.0 -> raw score > 0.
    # To get raw score = 0, we need W=0. W=0 if remaining_weight > 0 but upcoming_weight=0 (no scheduled assessment).
    subjects[0].assessments[0].scheduled_at = None
    subjects[1].assessments[0].scheduled_at = None

    engine_input = EngineInput(available_minutes=60, current_date=date(2026, 1, 1), subjects=subjects)
    res = calculate_allocations(engine_input)

    assert len(res) == 2
    assert res[0].allocated_minutes == 30
    assert res[1].allocated_minutes == 30
    assert res[0].snapshot_state.primary_driver == "BASELINE"
    assert res[1].snapshot_state.primary_driver == "BASELINE"

def test_small_time_edge_case():
    subjects = [
        EngineSubject(
            subject_id="s1",
            name="S1",
            assessments=[
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('50'), scheduled_at=date(2026, 1, 10))
            ]
        ),
        EngineSubject(
            subject_id="s2",
            name="S2",
            assessments=[
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('50'), scheduled_at=date(2026, 1, 2)) # Higher urgency
            ]
        )
    ]
    engine_input = EngineInput(available_minutes=10, current_date=date(2026, 1, 1), subjects=subjects)
    res = calculate_allocations(engine_input)

    assert len(res) == 1
    assert res[0].subject_id == "s2"
    assert res[0].allocated_minutes == 10

def test_exact_5_minute_allocations():
    # Fuzzing-like test for the invariant
    subjects = [
        EngineSubject(
            subject_id=f"s{i}",
            name=f"S{i}",
            assessments=[
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('50'), scheduled_at=date(2026, 1, i+1))
            ]
        ) for i in range(7)
    ]

    for available_minutes in range(15, 305, 5):
        engine_input = EngineInput(available_minutes=available_minutes, current_date=date(2026, 1, 1), subjects=subjects)
        res = calculate_allocations(engine_input)

        total = 0
        for r in res:
            assert r.allocated_minutes % 5 == 0
            total += r.allocated_minutes
        assert total == available_minutes

def test_deterministic_tie_breaking():
    # Two identical subjects. The tie breaker is subject_id descending.
    subjects = [
        EngineSubject(
            subject_id="a_subject",
            name="A",
            assessments=[
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('50'), scheduled_at=date(2026, 1, 2))
            ]
        ),
        EngineSubject(
            subject_id="z_subject",
            name="Z",
            assessments=[
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('50'), scheduled_at=date(2026, 1, 2))
            ]
        )
    ]
    # available_minutes = 15. They should get 7.5 each, rounded.
    # One gets 10, one gets 5.
    # Due to subject_id descending tie-break for positive fractional remainder...
    # Wait, both have 7.5. Remainder = 7.5 - 5 = 2.5 (Wait, round(7.5/5)*5 = round(1.5)*5 = 10 (if round goes to even, Python round(1.5)=2 -> 10).
    # If both round to 10, total is 20. Diff = 15 - 20 = -5.
    # We need to subtract 5. Sort by (allocated - raw) = (10 - 7.5) = 2.5.
    # Both have 2.5. Tie breaks: raw_score (same), U (same), remaining_weight (same), subject_id descending.
    # "z_subject" is > "a_subject", so "z_subject" is first to lose 5.
    # So "z_subject" gets 5, "a_subject" gets 10.
    engine_input = EngineInput(available_minutes=15, current_date=date(2026, 1, 1), subjects=subjects)
    res = calculate_allocations(engine_input)

    res_dict = {r.subject_id: r for r in res}
    assert res_dict["a_subject"].allocated_minutes == 10
    assert res_dict["z_subject"].allocated_minutes == 5

    # Run multiple times to ensure stability
    for _ in range(5):
        res = calculate_allocations(engine_input)
        res_dict = {r.subject_id: r for r in res}
        assert res_dict["a_subject"].allocated_minutes == 10
        assert res_dict["z_subject"].allocated_minutes == 5

def test_invalid_minutes_input():
    with pytest.raises(ValueError):
        calculate_allocations(EngineInput(available_minutes=17, current_date=date(2026, 1, 1), subjects=[]))
    with pytest.raises(ValueError):
        calculate_allocations(EngineInput(available_minutes=0, current_date=date(2026, 1, 1), subjects=[]))
    with pytest.raises(ValueError):
        calculate_allocations(EngineInput(available_minutes=-10, current_date=date(2026, 1, 1), subjects=[]))

from datetime import datetime

def test_upcoming_weight_aggregation():
    # 1. Two assessments on the same earliest date -> weights summed.
    # 2. Three assessments on same earliest date -> all weights summed.
    # 3. Same-day assessments at different times -> still grouped together.
    # 4. Later assessment is NOT included.
    # 5. Unscheduled assessment is NOT included in upcoming_weight.
    # 6. Scored assessment is NOT included.

    subjects = [
        EngineSubject(
            subject_id="s1",
            name="Two Same Date Different Times",
            assessments=[
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('10'), scheduled_at=datetime(2026, 1, 5, 9, 0)),
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('15'), scheduled_at=datetime(2026, 1, 5, 14, 0)),
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('20'), scheduled_at=datetime(2026, 1, 10, 10, 0)) # Later
            ]
        ),
        EngineSubject(
            subject_id="s2",
            name="Three Same Date + Unscheduled + Scored",
            assessments=[
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('5'), scheduled_at=datetime(2026, 1, 2, 8, 0)),
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('5'), scheduled_at=datetime(2026, 1, 2, 12, 0)),
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('10'), scheduled_at=datetime(2026, 1, 2, 16, 0)),
                EngineAssessment(status="pending", max_marks=Decimal('100'), weightage=Decimal('50'), scheduled_at=None), # Unscheduled
                EngineAssessment(status="scored", max_marks=Decimal('100'), marks=Decimal('100'), weightage=Decimal('20'), scheduled_at=datetime(2026, 1, 2, 10, 0)) # Scored
            ]
        )
    ]

    engine_input = EngineInput(available_minutes=60, current_date=date(2026, 1, 1), subjects=subjects)
    res = calculate_allocations(engine_input)
    res_dict = {r.subject_id: r for r in res}

    # S1 remaining weight = 10 + 15 + 20 = 45. Upcoming weight = 10 + 15 = 25.
    # Weight pressure W = 25 / 45
    expected_w1 = 25.0 / 45.0
    assert abs(res_dict["s1"].snapshot_state.raw_factors["weight_pressure"] - expected_w1) < 1e-5
    assert res_dict["s1"].snapshot_state.next_assessment["weight"] == 25.0

    # S2 remaining weight = 5 + 5 + 10 + 50 = 70. Upcoming weight = 5 + 5 + 10 = 20.
    # Weight pressure W = 20 / 70
    expected_w2 = 20.0 / 70.0
    assert abs(res_dict["s2"].snapshot_state.raw_factors["weight_pressure"] - expected_w2) < 1e-5
    assert res_dict["s2"].snapshot_state.next_assessment["weight"] == 20.0
