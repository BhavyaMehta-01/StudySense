import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
import jwt
from uuid import uuid4
from decimal import Decimal

from app.main import app
from app.database import engine, Base, SessionLocal
from app.models import User, Semester, Subject, Assessment
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

def get_token_for_user(db: Session, email: str, name: str) -> tuple[str, str, User]:
    user = User(email=email, password_hash="hash", name=name)
    db.add(user)
    db.commit()
    expire = datetime.now(timezone.utc) + timedelta(minutes=60)
    token = jwt.encode(
        {"sub": str(user.id), "exp": expire},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm
    )
    return str(user.id), token, user

def setup_academic_data(db: Session, user: User) -> Subject:
    sem = Semester(name="Fall 2026", academic_year="2026-2027", user_id=user.id)
    db.add(sem)
    db.commit()
    db.refresh(sem)
    
    subj = Subject(name="Math 101", credits=3.0, semester_id=sem.id)
    db.add(subj)
    db.commit()
    db.refresh(subj)
    
    ass1 = Assessment(name="Midterm", category="midsem", max_marks=100.0, marks=80.0, weightage=40.0, status="scored", subject_id=subj.id)
    ass2 = Assessment(name="Final", category="endsem", max_marks=100.0, weightage=60.0, status="pending", subject_id=subj.id)
    db.add_all([ass1, ass2])
    db.commit()
    
    return subj

def test_calculator_api_owned_subject(db_session: Session):
    _, token, user = get_token_for_user(db_session, "user1@example.com", "User 1")
    subj = setup_academic_data(db_session, user)
    
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post(f"/subjects/{subj.id}/calculate-required", json={"target_percentage": 75.0}, headers=headers)
    
    assert response.status_code == 200
    data = response.json()
    assert "earned_points" in data
    # earned = (80 / 100) * 40 = 32
    assert float(data["earned_points"]) == 32.0
    assert float(data["remaining_weight"]) == 60.0
    # required for 75: 75 - 32 = 43. 43 / 60 = 71.666...
    assert float(data["required_points_from_remaining"]) == 43.0
    assert data["target_achieved"] is False
    assert data["impossible"] is False

def test_calculator_api_foreign_subject(db_session: Session):
    _, token_a, user_a = get_token_for_user(db_session, "userA@example.com", "User A")
    _, _, user_b = get_token_for_user(db_session, "userB@example.com", "User B")
    
    # User B owns the subject
    subj_b = setup_academic_data(db_session, user_b)
    
    headers_a = {"Authorization": f"Bearer {token_a}"}
    response = client.post(f"/subjects/{subj_b.id}/calculate-required", json={"target_percentage": 75.0}, headers=headers_a)
    
    assert response.status_code == 404
    assert response.json()["detail"] == "Subject not found"

def test_calculator_api_nonexistent_subject(db_session: Session):
    _, token, user = get_token_for_user(db_session, "user_nx@example.com", "User NX")
    
    headers = {"Authorization": f"Bearer {token}"}
    fake_id = str(uuid4())
    response = client.post(f"/subjects/{fake_id}/calculate-required", json={"target_percentage": 75.0}, headers=headers)
    
    assert response.status_code == 404
    assert response.json()["detail"] == "Subject not found"

def test_calculator_api_impossible_target(db_session: Session):
    _, token, user = get_token_for_user(db_session, "user_imp@example.com", "User IMP")
    subj = setup_academic_data(db_session, user)
    
    headers = {"Authorization": f"Bearer {token}"}
    # With earned = 32 and remaining = 60, max possible is 92. A target of 95 is impossible.
    response = client.post(f"/subjects/{subj.id}/calculate-required", json={"target_percentage": 95.0}, headers=headers)
    
    assert response.status_code == 200
    data = response.json()
    assert data["impossible"] is True
    assert data["target_achieved"] is False
