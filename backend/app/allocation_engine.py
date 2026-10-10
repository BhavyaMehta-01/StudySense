from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from datetime import date, datetime
from decimal import Decimal
import uuid

class EngineAssessment(BaseModel):
    status: str
    marks: Optional[Decimal] = None
    max_marks: Decimal
    weightage: Decimal
    scheduled_at: Optional[datetime] = None

class EngineSubject(BaseModel):
    subject_id: str
    name: str
    target_percentage: Optional[int] = None
    assessments: List[EngineAssessment]

class EngineInput(BaseModel):
    available_minutes: int
    current_date: date
    subjects: List[EngineSubject]

class SnapshotState(BaseModel):
    subject_id: str
    subject_name: str
    subject_target: Optional[int]
    subject_current: Optional[float]
    remaining_weight: float
    next_assessment: Optional[Dict[str, Any]]
    raw_factors: Dict[str, float]
    primary_driver: str

class AllocationResult(BaseModel):
    subject_id: str
    allocated_minutes: int
    snapshot_state: SnapshotState
    explanation_code: str

def calculate_allocations(engine_input: EngineInput) -> List[AllocationResult]:
    if engine_input.available_minutes <= 0 or engine_input.available_minutes % 5 != 0:
        raise ValueError("available_minutes must be positive and divisible by 5")

    eligible_subjects = []
    subject_stats = {}

    for subject in engine_input.subjects:
        scored_weight = Decimal('0.0')
        earned_points = Decimal('0.0')
        remaining_weight = Decimal('0.0')

        has_non_scored = False
        next_assessment_date = None
        upcoming_weight = Decimal('0.0')

        # To find next assessment
        future_assessments = []

        for ass in subject.assessments:
            if ass.weightage <= 0:
                continue

            if ass.status == "scored":
                if ass.marks is not None and ass.max_marks > 0:
                    scored_weight += ass.weightage
                    earned_points += (ass.marks / ass.max_marks) * ass.weightage
            else:
                has_non_scored = True
                if ass.status != "exempt":
                    remaining_weight += ass.weightage
                    if ass.scheduled_at:
                        future_assessments.append(ass)
                    else:
                        # Unscheduled assessments contribute to remaining weight but not urgency
                        pass

        if not has_non_scored or remaining_weight <= 0:
            continue

        eligible_subjects.append(subject)

        # Current percentage
        current_percentage = None
        if scored_weight > 0:
            current_percentage = (earned_points / scored_weight) * Decimal('100.0')

        # Target deficit P
        P = 0.0
        if subject.target_percentage is not None and current_percentage is not None:
            deficit = (Decimal(subject.target_percentage) - current_percentage) / Decimal('100.0')
            P = max(0.0, float(deficit))

        # Urgency U
        U = 0.0
        if future_assessments:
            earliest_date = min(a.scheduled_at.date() for a in future_assessments)
            earliest_assessments = [a for a in future_assessments if a.scheduled_at.date() == earliest_date]

            days_until = (earliest_date - engine_input.current_date).days
            if days_until <= 0:
                U = 1.0
            else:
                U = max(0.0, 1.0 - (days_until / 14.0))

            upcoming_weight = sum(a.weightage for a in earliest_assessments)
            next_assessment_dict = {"days": days_until, "weight": float(upcoming_weight)}
        else:
            # If there are pending assessments but NONE have a date scheduled
            # treat urgency as 0, upcoming_weight as 0.
            # (Alternatively, could treat all remaining as upcoming, but urgency is date-driven)
            next_assessment_dict = None

        # Weight pressure W
        W = 0.0
        if remaining_weight > 0:
            W = float(upcoming_weight / remaining_weight)

        raw_score = U * 0.50 + P * 0.30 + W * 0.20

        # Determine primary driver
        drivers = [("URGENCY", U * 0.50), ("DEFICIT", P * 0.30), ("WEIGHT", W * 0.20)]
        drivers.sort(key=lambda x: (x[1], x[0]), reverse=True)
        primary_driver = drivers[0][0] if drivers[0][1] > 0 else "BASELINE"

        subject_stats[subject.subject_id] = {
            "subject": subject,
            "current_percentage": current_percentage,
            "remaining_weight": remaining_weight,
            "next_assessment_dict": next_assessment_dict,
            "U": U,
            "P": P,
            "W": W,
            "raw_score": raw_score,
            "primary_driver": primary_driver
        }

    if not eligible_subjects:
        return []

    # Check for all-zero
    all_zero = all(stat["raw_score"] == 0 for stat in subject_stats.values())
    if all_zero:
        for stat in subject_stats.values():
            stat["raw_score"] = 1.0
            stat["primary_driver"] = "BASELINE"

    # Normalize
    total_raw = sum(stat["raw_score"] for stat in subject_stats.values())
    for stat in subject_stats.values():
        stat["norm_score"] = stat["raw_score"] / total_raw if total_raw > 0 else 1.0 / len(eligible_subjects)

    # 60% cap
    num_eligible = len(eligible_subjects)
    if num_eligible > 2:
        capped_subjects = set()
        while True:
            excess = 0.0
            new_capped = False

            for sid, stat in subject_stats.items():
                if sid not in capped_subjects and stat["norm_score"] > 0.60:
                    excess += stat["norm_score"] - 0.60
                    stat["norm_score"] = 0.60
                    capped_subjects.add(sid)
                    new_capped = True

            if not new_capped or excess == 0 or len(capped_subjects) == num_eligible:
                break

            # Redistribute excess proportionally among uncapped
            uncapped = [sid for sid in subject_stats.keys() if sid not in capped_subjects]
            if not uncapped:
                break

            uncapped_total_norm = sum(subject_stats[sid]["norm_score"] for sid in uncapped)

            for sid in uncapped:
                if uncapped_total_norm > 0:
                    share = subject_stats[sid]["norm_score"] / uncapped_total_norm
                    subject_stats[sid]["norm_score"] += excess * share
                else:
                    subject_stats[sid]["norm_score"] += excess / len(uncapped)

    # Small time edge case
    if engine_input.available_minutes < 15:
        # Sort by norm_score -> U -> remaining_weight -> subject_id
        sorted_sids = sorted(
            subject_stats.keys(),
            key=lambda sid: (
                subject_stats[sid]["norm_score"],
                subject_stats[sid]["U"],
                float(subject_stats[sid]["remaining_weight"]),
                sid
            ),
            reverse=True
        )
        winner = sorted_sids[0]
        for sid in subject_stats:
            subject_stats[sid]["allocated_minutes"] = engine_input.available_minutes if sid == winner else 0
    else:
        # Multiply by available and round to nearest 5
        for stat in subject_stats.values():
            raw_minutes = stat["norm_score"] * engine_input.available_minutes
            stat["raw_minutes"] = raw_minutes
            stat["allocated_minutes"] = round(raw_minutes / 5) * 5

        # Fix invariant
        total_allocated = sum(stat["allocated_minutes"] for stat in subject_stats.values())
        diff = engine_input.available_minutes - total_allocated

        while diff != 0:
            if diff > 0:
                # Need to add minutes. Sort by largest positive fractional remainder
                # Tie breaks: raw_score, U, remaining_weight, subject_id (descending)
                # Remainder = raw_minutes - allocated_minutes
                sorted_sids = sorted(
                    subject_stats.keys(),
                    key=lambda sid: (
                        subject_stats[sid]["raw_minutes"] - subject_stats[sid]["allocated_minutes"],
                        subject_stats[sid]["raw_score"],
                        subject_stats[sid]["U"],
                        float(subject_stats[sid]["remaining_weight"]),
                        sid
                    ),
                    reverse=True
                )
                subject_stats[sorted_sids[0]]["allocated_minutes"] += 5
                diff -= 5
            elif diff < 0:
                # Need to subtract minutes. Sort by largest negative fractional remainder (smallest positive)
                # So we want to take away from those who got "rounded up" the most.
                # Remainder = raw_minutes - allocated_minutes (will be negative).
                # We sort by (allocated_minutes - raw_minutes) descending, which means smallest remainder.
                # Only subtract if allocated_minutes >= 5
                valid_sids = [sid for sid in subject_stats.keys() if subject_stats[sid]["allocated_minutes"] >= 5]
                if not valid_sids:
                    break

                sorted_sids = sorted(
                    valid_sids,
                    key=lambda sid: (
                        subject_stats[sid]["allocated_minutes"] - subject_stats[sid]["raw_minutes"],
                        -subject_stats[sid]["raw_score"],
                        -subject_stats[sid]["U"],
                        -float(subject_stats[sid]["remaining_weight"]),
                        sid # descending for tie break flip
                    ),
                    reverse=True
                )
                subject_stats[sorted_sids[0]]["allocated_minutes"] -= 5
                diff += 5

    # Build results
    results = []
    for sid, stat in subject_stats.items():
        if stat["allocated_minutes"] > 0:
            snapshot = SnapshotState(
                subject_id=sid,
                subject_name=stat["subject"].name,
                subject_target=stat["subject"].target_percentage,
                subject_current=float(stat["current_percentage"]) if stat["current_percentage"] is not None else None,
                remaining_weight=float(stat["remaining_weight"]),
                next_assessment=stat["next_assessment_dict"],
                raw_factors={
                    "urgency": stat["U"],
                    "deficit": stat["P"],
                    "weight_pressure": stat["W"]
                },
                primary_driver=stat["primary_driver"]
            )
            results.append(AllocationResult(
                subject_id=sid,
                allocated_minutes=stat["allocated_minutes"],
                snapshot_state=snapshot,
                explanation_code=f"ALLOCATED_{stat['primary_driver']}"
            ))

    return results
