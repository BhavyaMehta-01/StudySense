import pytest
from fastapi.testclient import TestClient
from app.main import app
from tests.test_academic_crud import get_token_for_user, setup_database, db_session

client = TestClient(app)

def test_dashboard_empty(db_session):
    token, user_id = get_token_for_user(db_session, "dash1@example.com", "Dash 1")
    resp = client.get("/dashboard", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_semesters"] == 0
    assert data["total_subjects"] == 0
    assert data["subject_summaries"] == []

def test_dashboard_populated(db_session):
    token, user_id = get_token_for_user(db_session, "dash2@example.com", "Dash 2")
    headers = {"Authorization": f"Bearer {token}"}
    
    sem = client.post("/semesters", json={"name": "S1", "academic_year": "26"}, headers=headers).json()
    sub = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Sub1"}, headers=headers).json()
    
    # Add scored assessment
    client.post(f"/subjects/{sub['id']}/assessments", json={
        "name": "Mid", "category": "midsem", "max_marks": 100, "marks": 80, "weightage": 40, "status": "scored"
    }, headers=headers)
    
    # Add pending assessment
    client.post(f"/subjects/{sub['id']}/assessments", json={
        "name": "End", "category": "endsem", "max_marks": 100, "weightage": 60, "status": "pending"
    }, headers=headers)
    
    # Add attendance
    client.post(f"/subjects/{sub['id']}/attendance", json={
        "classes_attended": 8, "classes_held": 10, "recorded_on": "2026-10-01"
    }, headers=headers)
    
    resp = client.get("/dashboard", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_semesters"] == 1
    assert data["total_subjects"] == 1
    
    summary = data["subject_summaries"][0]
    assert summary["semester_id"] == sem["id"]
    assert summary["semester_name"] == "S1"
    assert summary["subject_name"] == "Sub1"
    assert summary["earned_points"] == "32.00"  # 80/100 * 40
    assert summary["completed_weight"] == "40.00"
    assert summary["pending_weight"] == "60.00"
    assert summary["completed_work_percentage"] == "80.00" # 32/40
    assert summary["attendance_percentage"] == "80.00" # 8/10

def test_dashboard_qa_scenario(db_session):
    token, user_id = get_token_for_user(db_session, "dash_qa@example.com", "Dash QA")
    headers = {"Authorization": f"Bearer {token}"}

    sem = client.post("/semesters", json={"name": "Sem QA", "academic_year": "2026"}, headers=headers).json()
    sub = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Digital Electronics"}, headers=headers).json()
    sub_id = sub["id"]

    # 1. Assessment 1: Absent, weightage 20%
    client.post(f"/subjects/{sub_id}/assessments", json={
        "name": "Quiz 1", "category": "quiz", "max_marks": 20, "weightage": 20, "status": "absent"
    }, headers=headers)

    # 2. Assessment 2: Scored, weightage 20%, 20/25 marks
    client.post(f"/subjects/{sub_id}/assessments", json={
        "name": "Midsem", "category": "midsem", "max_marks": 25, "marks": 20, "weightage": 20, "status": "scored"
    }, headers=headers)

    # Check dashboard initial state
    data = client.get("/dashboard", headers=headers).json()
    summary = data["subject_summaries"][0]
    assert summary["completed_weight"] == "40.00"
    assert summary["earned_points"] == "16.00"  # (20/25)*20 = 16.0
    # 16.0 / 40.0 * 100 = 40.00%
    assert summary["completed_work_percentage"] == "40.00"

    # 3. Assessment 3: Pending, weightage 10%, max marks 10
    res_ass3 = client.post(f"/subjects/{sub_id}/assessments", json={
        "name": "QA Pending Test", "category": "assignment", "max_marks": 10, "weightage": 10, "status": "pending"
    }, headers=headers).json()

    # Dashboard remains 40% while pending
    data = client.get("/dashboard", headers=headers).json()
    summary = data["subject_summaries"][0]
    assert summary["completed_weight"] == "40.00"
    assert summary["pending_weight"] == "10.00"
    assert summary["completed_work_percentage"] == "40.00"

    # 4. Change Assessment 3 to Scored with 8/10
    client.put(f"/assessments/{res_ass3['id']}", json={
        "status": "scored", "marks": 8
    }, headers=headers)

    # Dashboard now shows 48% Current Average and 50% Course Completion (24.0 / 50.0 * 100 = 48.00%)
    data = client.get("/dashboard", headers=headers).json()
    summary = data["subject_summaries"][0]
    assert summary["completed_weight"] == "50.00"
    assert summary["earned_points"] == "24.00"  # 16.0 + (8/10)*10 = 24.0
    assert summary["completed_work_percentage"] == "48.00"

    # 5. Add Exempt assessment (weightage 30%): Excluded from completed_weight and earned_points
    res_exempt = client.post(f"/subjects/{sub_id}/assessments", json={
        "name": "Exempt Project", "category": "project", "max_marks": 50, "weightage": 30, "status": "exempt"
    }, headers=headers).json()

    data = client.get("/dashboard", headers=headers).json()
    summary = data["subject_summaries"][0]
    assert summary["completed_weight"] == "50.00"
    assert summary["earned_points"] == "24.00"
    assert summary["completed_work_percentage"] == "48.00"

    # 6. Edit Assessment 3 marks from 8 to 10
    client.put(f"/assessments/{res_ass3['id']}", json={
        "marks": 10
    }, headers=headers)

    data = client.get("/dashboard", headers=headers).json()
    summary = data["subject_summaries"][0]
    assert summary["completed_weight"] == "50.00"
    assert summary["earned_points"] == "26.00"  # 16.0 + (10/10)*10 = 26.0
    assert summary["completed_work_percentage"] == "52.00"  # 26.0 / 50.0 * 100

    # 7. Delete Assessment 3: metrics revert
    client.delete(f"/assessments/{res_ass3['id']}", headers=headers)

    data = client.get("/dashboard", headers=headers).json()
    summary = data["subject_summaries"][0]
    assert summary["completed_weight"] == "40.00"
    assert summary["earned_points"] == "16.00"
    assert summary["completed_work_percentage"] == "40.00"

def test_dashboard_no_completed_assessments_and_semesters(db_session):
    token, user_id = get_token_for_user(db_session, "dash_multi@example.com", "Dash Multi")
    headers = {"Authorization": f"Bearer {token}"}

    # Semester 1 with a subject having only a pending assessment
    sem1 = client.post("/semesters", json={"name": "Semester 1", "academic_year": "2026"}, headers=headers).json()
    sub1 = client.post(f"/semesters/{sem1['id']}/subjects", json={"name": "Physics"}, headers=headers).json()
    client.post(f"/subjects/{sub1['id']}/assessments", json={
        "name": "Final Exam", "category": "endsem", "max_marks": 100, "weightage": 50, "status": "pending"
    }, headers=headers)

    # Semester 2 with a subject having zero assessments
    sem2 = client.post("/semesters", json={"name": "Semester 2", "academic_year": "2027"}, headers=headers).json()
    sub2 = client.post(f"/semesters/{sem2['id']}/subjects", json={"name": "Chemistry"}, headers=headers).json()

    data = client.get("/dashboard", headers=headers).json()
    assert data["total_semesters"] == 2
    assert data["total_subjects"] == 2

    # Map summaries by subject name
    summaries = {s["subject_name"]: s for s in data["subject_summaries"]}

    # Physics: pending only -> completed_weight 0.00, completed_work_percentage None
    physics = summaries["Physics"]
    assert physics["semester_name"] == "Semester 1"
    assert physics["completed_weight"] == "0.00"
    assert physics["pending_weight"] == "50.00"
    assert physics["completed_work_percentage"] is None
    assert physics["earned_points"] == "0.00"

    # Chemistry: no assessments -> completed_weight 0.00, completed_work_percentage None
    chem = summaries["Chemistry"]
    assert chem["semester_name"] == "Semester 2"
    assert chem["completed_weight"] == "0.00"
    assert chem["pending_weight"] == "0.00"
    assert chem["completed_work_percentage"] is None
    assert chem["earned_points"] == "0.00"
