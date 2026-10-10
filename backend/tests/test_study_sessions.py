import pytest
from fastapi.testclient import TestClient
from datetime import date, timedelta
from sqlalchemy.exc import IntegrityError
from unittest.mock import patch

from app.main import app
from app.models import User, Semester, Subject, StudyPlan, StudyPlanAllocation, StudySession
from tests.test_study_plans import create_user_and_token

client = TestClient(app)

from app.database import Base, engine, SessionLocal

@pytest.fixture(scope="module")
def setup_database():
    Base.metadata.create_all(bind=engine)
    yield

@pytest.fixture
def db_session(setup_database):
    connection = engine.connect()
    transaction = connection.begin()
    session = SessionLocal(bind=connection, join_transaction_mode="create_savepoint")

    from app.dependencies import get_db
    def override_get_db():
        yield session

    app.dependency_overrides[get_db] = override_get_db
    yield session

    app.dependency_overrides.clear()
    session.close()
    transaction.rollback()

def setup_plan_and_allocation(db_session, email):
    token, user_id = create_user_and_token(db_session, email)
    headers = {"Authorization": f"Bearer {token}"}
    
    # 1. Create active semester
    sem = client.post("/semesters", json={"name": "S1", "academic_year": "2026"}, headers=headers).json()
    client.patch(f"/semesters/{sem['id']}/activate", headers=headers)
    
    # 2. Create subject
    sub = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Math"}, headers=headers).json()
    
    # 3. Create assessment
    client.post(f"/subjects/{sub['id']}/assessments", json={
        "name": "Midterm", "category": "midsem", "max_marks": 100, "weightage": 50
    }, headers=headers)
    
    # 4. Create study plan (Monday to Sunday)
    start_date = date(2026, 10, 12)
    end_date = date(2026, 10, 18)
    plan_resp = client.post("/study-plans", json={
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "available_minutes": 60
    }, headers=headers)
    
    assert plan_resp.status_code == 200
    plan_data = plan_resp.json()
    alloc_id = plan_data["allocations"][0]["id"]
    
    return headers, user_id, plan_data["id"], alloc_id, start_date, end_date

def test_unauthenticated_request():
    response = client.post("/study-sessions", json={
        "allocation_id": "00000000-0000-0000-0000-000000000000",
        "date": "2026-10-12",
        "duration_minutes": 30,
        "status": "completed"
    })
    assert response.status_code in (401, 403)
    
    response2 = client.get("/study-sessions")
    assert response2.status_code in (401, 403)

def test_successful_creation(db_session):
    headers, user_id, plan_id, alloc_id, start_date, end_date = setup_plan_and_allocation(db_session, "success@example.com")
    
    # Create completed session
    resp1 = client.post("/study-sessions", json={
        "allocation_id": alloc_id,
        "date": start_date.isoformat(),
        "duration_minutes": 45,
        "status": "completed"
    }, headers=headers)
    assert resp1.status_code == 200
    data1 = resp1.json()
    assert data1["duration_minutes"] == 45
    assert data1["status"] == "completed"
    assert data1["user_id"] == str(user_id)
    
    # Create partial session
    resp2 = client.post("/study-sessions", json={
        "allocation_id": alloc_id,
        "date": start_date.isoformat(),
        "duration_minutes": 15,
        "status": "partial"
    }, headers=headers)
    assert resp2.status_code == 200
    assert resp2.json()["status"] == "partial"
    
    # Create skipped session
    resp3 = client.post("/study-sessions", json={
        "allocation_id": alloc_id,
        "date": start_date.isoformat(),
        "duration_minutes": 0,
        "status": "skipped"
    }, headers=headers)
    assert resp3.status_code == 200
    assert resp3.json()["status"] == "skipped"

def test_invalid_status_duration_combinations(db_session):
    headers, user_id, plan_id, alloc_id, start_date, end_date = setup_plan_and_allocation(db_session, "invalid@example.com")
    
    # Skipped with duration > 0
    resp = client.post("/study-sessions", json={
        "allocation_id": alloc_id,
        "date": start_date.isoformat(),
        "duration_minutes": 30,
        "status": "skipped"
    }, headers=headers)
    assert resp.status_code == 422
    
    # Completed with duration == 0
    resp = client.post("/study-sessions", json={
        "allocation_id": alloc_id,
        "date": start_date.isoformat(),
        "duration_minutes": 0,
        "status": "completed"
    }, headers=headers)
    assert resp.status_code == 422
    
    # Partial with duration == 0
    resp = client.post("/study-sessions", json={
        "allocation_id": alloc_id,
        "date": start_date.isoformat(),
        "duration_minutes": 0,
        "status": "partial"
    }, headers=headers)
    assert resp.status_code == 422
    
    # Negative duration
    resp = client.post("/study-sessions", json={
        "allocation_id": alloc_id,
        "date": start_date.isoformat(),
        "duration_minutes": -10,
        "status": "completed"
    }, headers=headers)
    assert resp.status_code == 422
    
    # Invalid status
    resp = client.post("/study-sessions", json={
        "allocation_id": alloc_id,
        "date": start_date.isoformat(),
        "duration_minutes": 30,
        "status": "done"
    }, headers=headers)
    assert resp.status_code == 422

def test_missing_and_cross_user_allocation(db_session):
    h1, u1, p1, a1, sd1, ed1 = setup_plan_and_allocation(db_session, "user1@example.com")
    h2, u2, p2, a2, sd2, ed2 = setup_plan_and_allocation(db_session, "user2@example.com")
    
    # Fake allocation
    resp = client.post("/study-sessions", json={
        "allocation_id": "00000000-0000-0000-0000-000000000000",
        "date": sd1.isoformat(),
        "duration_minutes": 30,
        "status": "completed"
    }, headers=h1)
    assert resp.status_code == 404
    
    # User 1 tries to log against User 2's allocation
    resp = client.post("/study-sessions", json={
        "allocation_id": a2,
        "date": sd1.isoformat(),
        "duration_minutes": 30,
        "status": "completed"
    }, headers=h1)
    assert resp.status_code == 404

def test_historical_plan(db_session):
    headers, user_id, plan_id, alloc_id, start_date, end_date = setup_plan_and_allocation(db_session, "hist@example.com")
    
    # Deactivate the plan manually
    db_plan = db_session.query(StudyPlan).filter_by(id=plan_id).first()
    db_plan.is_active = False
    db_session.commit()
    
    # Can still log session
    resp = client.post("/study-sessions", json={
        "allocation_id": alloc_id,
        "date": start_date.isoformat(),
        "duration_minutes": 30,
        "status": "completed"
    }, headers=headers)
    assert resp.status_code == 200

def test_date_boundaries(db_session):
    headers, user_id, plan_id, alloc_id, start_date, end_date = setup_plan_and_allocation(db_session, "dates@example.com")
    
    # Before start date
    resp = client.post("/study-sessions", json={
        "allocation_id": alloc_id,
        "date": (start_date - timedelta(days=1)).isoformat(),
        "duration_minutes": 30,
        "status": "completed"
    }, headers=headers)
    assert resp.status_code == 400
    assert "within the studyplan period" in resp.json()["detail"].lower()
    
    # After end date
    resp = client.post("/study-sessions", json={
        "allocation_id": alloc_id,
        "date": (end_date + timedelta(days=1)).isoformat(),
        "duration_minutes": 30,
        "status": "completed"
    }, headers=headers)
    assert resp.status_code == 400
    
    # Exactly on start date (should succeed)
    resp = client.post("/study-sessions", json={
        "allocation_id": alloc_id,
        "date": start_date.isoformat(),
        "duration_minutes": 30,
        "status": "completed"
    }, headers=headers)
    assert resp.status_code == 200
    
    # Exactly on end date (should succeed)
    resp = client.post("/study-sessions", json={
        "allocation_id": alloc_id,
        "date": end_date.isoformat(),
        "duration_minutes": 30,
        "status": "completed"
    }, headers=headers)
    assert resp.status_code == 200

def test_list_sessions(db_session):
    headers, user_id, plan_id, alloc_id, start_date, end_date = setup_plan_and_allocation(db_session, "list@example.com")
    
    # Create two sessions
    client.post("/study-sessions", json={
        "allocation_id": alloc_id,
        "date": start_date.isoformat(),
        "duration_minutes": 30,
        "status": "completed"
    }, headers=headers)
    
    client.post("/study-sessions", json={
        "allocation_id": alloc_id,
        "date": end_date.isoformat(),
        "duration_minutes": 0,
        "status": "skipped"
    }, headers=headers)
    
    # Get all
    resp = client.get("/study-sessions", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    # Deterministic order: newest date first
    assert data[0]["date"] == end_date.isoformat()
    assert data[1]["date"] == start_date.isoformat()
    
    # Get by plan_id
    resp = client.get(f"/study-sessions?plan_id={plan_id}", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 2
    
    # Get by fake plan_id
    resp = client.get("/study-sessions?plan_id=00000000-0000-0000-0000-000000000000", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 0

def test_persistence_failure_rollback(db_session):
    headers, user_id, plan_id, alloc_id, start_date, end_date = setup_plan_and_allocation(db_session, "roll@example.com")
    
    with patch("sqlalchemy.orm.Session.commit", side_effect=IntegrityError("forced", params=None, orig=None)):
        resp = client.post("/study-sessions", json={
            "allocation_id": alloc_id,
            "date": start_date.isoformat(),
            "duration_minutes": 30,
            "status": "completed"
        }, headers=headers)
        assert resp.status_code == 400
        
    # Check DB was rolled back
    sessions = db_session.query(StudySession).filter_by(user_id=user_id).all()
    assert len(sessions) == 0
