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
