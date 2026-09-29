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
