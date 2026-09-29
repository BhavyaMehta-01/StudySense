from decimal import Decimal
from typing import List, Dict, Union

def calculate_required_score(target_percentage: Decimal, assessments: List[Dict]) -> Dict[str, Union[bool, Decimal, str]]:
    """
    assessments list of dicts:
    {
        "status": str,  # 'scored', 'pending', 'absent', 'exempt'
        "marks": Decimal, (nullable)
        "max_marks": Decimal,
        "weightage": Decimal
    }
    """
    earned_points = Decimal('0.0')
    remaining_weight = Decimal('0.0')
    total_valid_weight = Decimal('0.0')

    for ass in assessments:
        weight = ass.get("weightage")
        if not weight or weight <= 0:
            continue
            
        status = ass.get("status", "pending")
        if status == "exempt":
            continue
            
        total_valid_weight += weight
        
        if status == "scored":
            marks = ass.get("marks")
            max_marks = ass.get("max_marks")
            if marks is not None and max_marks and max_marks > 0:
                earned_points += (marks / max_marks) * weight
        elif status == "absent":
            # 0 marks earned, but weight is consumed
            pass
        elif status == "pending":
            remaining_weight += weight

    result = {
        "earned_points": earned_points,
        "remaining_weight": remaining_weight,
        "total_valid_weight": total_valid_weight,
        "target_achieved": False,
        "impossible": False,
        "required_remaining_percentage": Decimal('0.0'),
        "required_points_from_remaining": Decimal('0.0')
    }

    if earned_points >= target_percentage:
        result["target_achieved"] = True
        return result

    required_points = target_percentage - earned_points
    result["required_points_from_remaining"] = required_points

    if remaining_weight <= 0:
        result["impossible"] = True
        return result

    # Calculate percentage needed on the remaining work
    required_percentage = (required_points / remaining_weight) * Decimal('100.0')
    result["required_remaining_percentage"] = required_percentage

    if required_percentage > Decimal('100.0'):
        result["impossible"] = True

    return result
