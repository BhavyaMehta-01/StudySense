from decimal import Decimal
from app.calculator import calculate_required_score

def test_calculator_normal():
    assessments = [
        {"status": "scored", "marks": Decimal(15), "max_marks": Decimal(20), "weightage": Decimal(20)}, # earned = 15
        {"status": "pending", "weightage": Decimal(40)},
        {"status": "pending", "weightage": Decimal(40)}
    ]
    # earned = 15.0
    # target = 75
    # required = 60
    # remaining weight = 80
    # required % = 60 / 80 = 75%
    res = calculate_required_score(Decimal(75), assessments)
    assert res["target_achieved"] is False
    assert res["impossible"] is False
    assert round(res["earned_points"], 2) == Decimal('15.00')
    assert round(res["remaining_weight"], 2) == Decimal('80.00')
    assert round(res["required_remaining_percentage"], 2) == Decimal('75.00')

def test_calculator_target_achieved():
    assessments = [
        {"status": "scored", "marks": Decimal(80), "max_marks": Decimal(100), "weightage": Decimal(100)},
    ]
    res = calculate_required_score(Decimal(75), assessments)
    assert res["target_achieved"] is True
    assert res["impossible"] is False

def test_calculator_impossible():
    assessments = [
        {"status": "scored", "marks": Decimal(0), "max_marks": Decimal(100), "weightage": Decimal(50)},
        {"status": "pending", "weightage": Decimal(50)}
    ]
    # max possible is 50. Target is 75.
    res = calculate_required_score(Decimal(75), assessments)
    assert res["impossible"] is True
    assert res["target_achieved"] is False

def test_calculator_no_remaining():
    assessments = [
        {"status": "scored", "marks": Decimal(50), "max_marks": Decimal(100), "weightage": Decimal(100)},
    ]
    res = calculate_required_score(Decimal(75), assessments)
    assert res["impossible"] is True

def test_calculator_absent_and_exempt():
    assessments = [
        {"status": "scored", "marks": Decimal(20), "max_marks": Decimal(20), "weightage": Decimal(20)}, # earned = 20
        {"status": "absent", "weightage": Decimal(20)}, # earned = 0, consumed
        {"status": "exempt", "weightage": Decimal(20)}, # ignored completely
        {"status": "pending", "weightage": Decimal(40)} # remaining = 40
    ]
    # valid total weight = 80
    # earned = 20
    # required for 50 = 30
    # remaining = 40
    # required % = 30 / 40 = 75%
    res = calculate_required_score(Decimal(50), assessments)
    assert res["total_valid_weight"] == Decimal('80')
    assert res["impossible"] is False
    assert round(res["required_remaining_percentage"], 2) == Decimal('75.00')


def test_calculator_unallocated_remaining_weight():
    # Exact reproduction case:
    # 1 scored assessment: 20% weight, 20/25 marks earned (16 points)
    # Remaining weight: 100% - 20% = 80% (all unallocated)
    # Target: 75%
    # Required points: 75 - 16 = 59 points
    # Required % on remaining: (59 / 80) * 100 = 73.75%
    assessments = [
        {"status": "scored", "marks": Decimal(20), "max_marks": Decimal(25), "weightage": Decimal(20)}
    ]
    res = calculate_required_score(Decimal(75), assessments)
    assert res["target_achieved"] is False
    assert res["impossible"] is False
    assert round(res["earned_points"], 2) == Decimal('16.00')
    assert round(res["remaining_weight"], 2) == Decimal('80.00')
    assert round(res["required_points_from_remaining"], 2) == Decimal('59.00')
    assert round(res["required_remaining_percentage"], 2) == Decimal('73.75')


def test_calculator_no_assessments():
    # Brand new subject with no assessments yet
    assessments = []
    res = calculate_required_score(Decimal(75), assessments)
    assert res["target_achieved"] is False
    assert res["impossible"] is False
    assert round(res["earned_points"], 2) == Decimal('0.00')
    assert round(res["remaining_weight"], 2) == Decimal('100.00')
    assert round(res["required_points_from_remaining"], 2) == Decimal('75.00')
    assert round(res["required_remaining_percentage"], 2) == Decimal('75.00')


def test_calculator_partial_pending_and_unallocated():
    # 20% scored (20/25 -> 16 pts), 30% pending, 50% unallocated -> total remaining = 80%
    assessments = [
        {"status": "scored", "marks": Decimal(20), "max_marks": Decimal(25), "weightage": Decimal(20)},
        {"status": "pending", "weightage": Decimal(30)}
    ]
    res = calculate_required_score(Decimal(75), assessments)
    assert res["target_achieved"] is False
    assert res["impossible"] is False
    assert round(res["earned_points"], 2) == Decimal('16.00')
    assert round(res["remaining_weight"], 2) == Decimal('80.00')
    assert round(res["required_points_from_remaining"], 2) == Decimal('59.00')
    assert round(res["required_remaining_percentage"], 2) == Decimal('73.75')
    assert round(res["max_achievable_score"], 2) == Decimal('96.00')


def test_calculator_max_achievable_score_impossible():
    # 50% weight scored 0/100 -> 0 points earned.
    # 50% remaining weight.
    # Max achievable = 0 + 50 = 50.00%. Target 75% is impossible.
    assessments = [
        {"status": "scored", "marks": Decimal(0), "max_marks": Decimal(100), "weightage": Decimal(50)},
        {"status": "pending", "weightage": Decimal(50)}
    ]
    res = calculate_required_score(Decimal(75), assessments)
    assert res["impossible"] is True
    assert round(res["max_achievable_score"], 2) == Decimal('50.00')
