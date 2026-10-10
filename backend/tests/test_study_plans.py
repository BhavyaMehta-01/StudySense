from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from datetime import date, timedelta, datetime, timezone
import pytest
import jwt
from app.main import app
from app.database import engine, Base, SessionLocal
from app.config import settings

client = TestClient(app)

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
    connection.close()

def create_user_and_token(db_session, email="testplan@example.com", name="Test Plan User"):
    from app.models import User
    from app.auth import get_password_hash
    user = User(email=email, name=name, password_hash=get_password_hash("password"))
    db_session.add(user)
    db_session.commit()
    expire = datetime.now(timezone.utc) + timedelta(minutes=60)
    to_encode = {"sub": str(user.id), "exp": expire}
    token = jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, user.id

def test_unauthenticated_request():
    response = client.post("/study-plans", json={
        "start_date": "2026-10-12",
        "end_date": "2026-10-18",
        "available_minutes": 120
    })
    assert response.status_code in (401, 403)

def test_no_active_semester(db_session):
    token, user_id = create_user_and_token(db_session, "noactive@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.post("/study-plans", json={
        "start_date": "2026-10-12",
        "end_date": "2026-10-18",
        "available_minutes": 120
    }, headers=headers)
    assert response.status_code == 409
    assert "no active semester" in response.json()["detail"].lower()

def test_active_semester_no_eligible_subjects(db_session):
    token, user_id = create_user_and_token(db_session, "nosubj@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    # Create active semester
    sem = client.post("/semesters", json={"name": "Sem1", "academic_year": "2026"}, headers=headers).json()
    client.patch(f"/semesters/{sem['id']}/activate", headers=headers)

    response = client.post("/study-plans", json={
        "start_date": "2026-10-12",
        "end_date": "2026-10-18",
        "available_minutes": 120
    }, headers=headers)

    assert response.status_code == 400
    assert "no eligible subjects" in response.json()["detail"].lower()

def test_request_validation(db_session):
    token, user_id = create_user_and_token(db_session, "val@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    # Valid Monday-Sunday range is accepted (assuming valid subjects exist, but 400 means Pydantic validation passed)
    sem = client.post("/semesters", json={"name": "Sem1", "academic_year": "2026"}, headers=headers).json()
    client.patch(f"/semesters/{sem['id']}/activate", headers=headers)

    resp = client.post("/study-plans", json={
        "start_date": "2026-10-12", # Monday
        "end_date": "2026-10-18", # Sunday
        "available_minutes": 120
    }, headers=headers)
    assert resp.status_code == 400 # Fails on "no eligible subjects" instead of 422

    # Tuesday start date is rejected
    resp = client.post("/study-plans", json={
        "start_date": "2026-10-13", # Tuesday
        "end_date": "2026-10-18",
        "available_minutes": 120
    }, headers=headers)
    assert resp.status_code == 422

    # Saturday end date is rejected
    resp = client.post("/study-plans", json={
        "start_date": "2026-10-12",
        "end_date": "2026-10-17", # Saturday
        "available_minutes": 120
    }, headers=headers)
    assert resp.status_code == 422

    # Invalid dates (end < start)
    resp = client.post("/study-plans", json={
        "start_date": "2026-10-19", # Monday
        "end_date": "2026-10-18", # Sunday (but before start)
        "available_minutes": 120
    }, headers=headers)
    assert resp.status_code == 422

    # Negative minutes
    resp = client.post("/study-plans", json={
        "start_date": "2026-10-12",
        "end_date": "2026-10-18",
        "available_minutes": -60
    }, headers=headers)
    assert resp.status_code == 422

    # Not div by 5
    resp = client.post("/study-plans", json={
        "start_date": "2026-10-12",
        "end_date": "2026-10-18",
        "available_minutes": 123
    }, headers=headers)
    assert resp.status_code == 422

def test_successful_plan_creation_and_isolation(db_session):
    token1, user_id1 = create_user_and_token(db_session, "user1@example.com")
    headers1 = {"Authorization": f"Bearer {token1}"}

    token2, user_id2 = create_user_and_token(db_session, "user2@example.com")
    headers2 = {"Authorization": f"Bearer {token2}"}

    # User 1 active semester and subjects
    sem1 = client.post("/semesters", json={"name": "Sem1", "academic_year": "2026"}, headers=headers1).json()
    client.patch(f"/semesters/{sem1['id']}/activate", headers=headers1)

    # User 2 inactive semester and subjects (to test isolation)
    sem2 = client.post("/semesters", json={"name": "Sem2", "academic_year": "2026"}, headers=headers2).json()
    sub2 = client.post(f"/semesters/{sem2['id']}/subjects", json={"name": "Sub2"}, headers=headers2).json()
    client.post(f"/subjects/{sub2['id']}/assessments", json={"name": "Ass2", "category": "assignment", "max_marks": 100, "weightage": 50}, headers=headers2)

    # User 1 eligible subject
    sub1 = client.post(f"/semesters/{sem1['id']}/subjects", json={"name": "Sub1"}, headers=headers1).json() # no target
    ass1 = client.post(f"/subjects/{sub1['id']}/assessments", json={
        "name": "Ass1", "category": "assignment", "max_marks": 100, "weightage": 40
    }, headers=headers1).json()

    # User 1 scored assessment (should not contribute to remaining)
    client.post(f"/subjects/{sub1['id']}/assessments", json={
        "name": "Ass1_scored", "category": "quiz", "max_marks": 10, "marks": 5, "weightage": 10, "status": "scored"
    }, headers=headers1)

    resp = client.post("/study-plans", json={
        "start_date": "2026-10-12",
        "end_date": "2026-10-18",
        "available_minutes": 100
    }, headers=headers1)

    assert resp.status_code == 200
    plan = resp.json()
    assert plan["available_minutes"] == 100
    assert plan["is_active"] is True
    assert len(plan["allocations"]) == 1

    alloc = plan["allocations"][0]
    assert alloc["allocated_minutes"] == 100
    assert alloc["subject_id"] == sub1["id"]
    assert alloc["snapshot_state"]["subject_target"] is None # target NULL
    assert alloc["snapshot_state"]["remaining_weight"] == 40.0 # scored one did not contribute

    # Verify DB
    from app.models import StudyPlan, StudyPlanAllocation
    db_plan = db_session.query(StudyPlan).filter_by(id=plan["id"]).first()
    assert db_plan is not None
    assert db_plan.is_active is True
    assert len(db_plan.allocations) == 1

def test_existing_active_plan_conflict(db_session):
    token, user_id = create_user_and_token(db_session, "conflict@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    sem = client.post("/semesters", json={"name": "Sem1", "academic_year": "2026"}, headers=headers).json()
    client.patch(f"/semesters/{sem['id']}/activate", headers=headers)

    sub = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Sub"}, headers=headers).json()
    client.post(f"/subjects/{sub['id']}/assessments", json={"name": "Ass", "category": "assignment", "max_marks": 100, "weightage": 50}, headers=headers)

    resp1 = client.post("/study-plans", json={
        "start_date": "2026-10-12",
        "end_date": "2026-10-18",
        "available_minutes": 60
    }, headers=headers)
    assert resp1.status_code == 200

    resp2 = client.post("/study-plans", json={
        "start_date": "2026-10-19",
        "end_date": "2026-10-25",
        "available_minutes": 60
    }, headers=headers)
    assert resp2.status_code == 409

def test_database_failure_rollback(db_session):
    token, user_id = create_user_and_token(db_session, "rollback@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    sem = client.post("/semesters", json={"name": "Sem1", "academic_year": "2026"}, headers=headers).json()
    client.patch(f"/semesters/{sem['id']}/activate", headers=headers)

    sub = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Sub"}, headers=headers).json()
    client.post(f"/subjects/{sub['id']}/assessments", json={"name": "Ass", "category": "assignment", "max_marks": 100, "weightage": 50}, headers=headers)

    from unittest.mock import patch
    from sqlalchemy.exc import IntegrityError

    with patch("sqlalchemy.orm.Session.commit", side_effect=IntegrityError("forced", params=None, orig=None)):
        resp = client.post("/study-plans", json={
            "start_date": "2026-10-12",
            "end_date": "2026-10-18",
            "available_minutes": 60
        }, headers=headers)
        assert resp.status_code == 409

    # Verify no plan was saved
    from app.models import StudyPlan
    count = db_session.query(StudyPlan).filter_by(user_id=user_id).count()
    assert count == 0
