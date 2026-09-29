import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
import jwt

from app.main import app
from app.database import engine, Base, SessionLocal
from app.models import User, Semester, Subject, Assessment, Attendance
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

def get_token_for_user(db: Session, email: str, name: str) -> tuple[str, str]:
    user = User(email=email, password_hash="hash", name=name)
    db.add(user)
    db.commit()
    expire = datetime.now(timezone.utc) + timedelta(minutes=60)
    to_encode = {"sub": str(user.id), "exp": expire}
    token = jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, str(user.id)

def test_unauthenticated_access_rejected():
    response = client.get("/semesters")
    assert response.status_code == 403

def test_semester_crud(db_session):
    token, user_id = get_token_for_user(db_session, "crud1@example.com", "CRUD 1")
    headers = {"Authorization": f"Bearer {token}"}
    
    # 1. create semester
    resp = client.post("/semesters", json={"name": "Fall 2026", "academic_year": "2026-2027"}, headers=headers)
    assert resp.status_code == 200
    sem_id = resp.json()["id"]
    
    # 2. list semester
    resp = client.get("/semesters", headers=headers)
    assert len(resp.json()) == 1
    
    # 3. get semester
    resp = client.get(f"/semesters/{sem_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Fall 2026"
    
    # 4. update semester
    resp = client.put(f"/semesters/{sem_id}", json={"name": "Spring 2027"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Spring 2027"
    
    # 5. delete semester
    resp = client.delete(f"/semesters/{sem_id}", headers=headers)
    assert resp.status_code == 204
    
    # verify deleted
    resp = client.get(f"/semesters/{sem_id}", headers=headers)
    assert resp.status_code == 404

def test_subject_assessment_attendance_crud(db_session):
    token, user_id = get_token_for_user(db_session, "crud2@example.com", "CRUD 2")
    headers = {"Authorization": f"Bearer {token}"}
    
    # create semester
    sem_resp = client.post("/semesters", json={"name": "Sem 1", "academic_year": "2026"}, headers=headers)
    sem_id = sem_resp.json()["id"]
    
    # 6. subject creation
    sub_resp = client.post(f"/semesters/{sem_id}/subjects", json={"name": "Math", "code": "M101", "credits": 3}, headers=headers)
    assert sub_resp.status_code == 200
    sub_id = sub_resp.json()["id"]
    
    # subject retrieval
    assert client.get(f"/subjects/{sub_id}", headers=headers).status_code == 200
    
    # 7. assessment creation
    ass_resp = client.post(
        f"/subjects/{sub_id}/assessments",
        json={"name": "Midterm", "category": "midsem", "max_marks": 100, "weightage": 40},
        headers=headers
    )
    assert ass_resp.status_code == 200
    ass_id = ass_resp.json()["id"]
    
    # 9. attendance creation
    att_resp = client.post(
        f"/subjects/{sub_id}/attendance",
        json={"classes_attended": 8, "classes_held": 10, "recorded_on": "2026-10-01"},
        headers=headers
    )
    assert att_resp.status_code == 200

    # 18. assessment aggregate weightage logic
    heavy_ass_resp = client.post(
        f"/subjects/{sub_id}/assessments",
        json={"name": "Final", "category": "endsem", "max_marks": 100, "weightage": 70}, # 40 + 70 = 110 > 100
        headers=headers
    )
    assert heavy_ass_resp.status_code == 400
    assert "exceed 100%" in heavy_ass_resp.json()["detail"]

    # assessment validation (db constraint check)
    bad_ass_resp = client.post(
        f"/subjects/{sub_id}/assessments",
        json={"name": "Bad", "category": "invalid_category", "max_marks": 10},
        headers=headers
    )
    assert bad_ass_resp.status_code == 400

    
def test_idor_protection_and_invalid_ids(db_session):
    token_a, user_a = get_token_for_user(db_session, "a@example.com", "A")
    headers_a = {"Authorization": f"Bearer {token_a}"}
    
    token_b, user_b = get_token_for_user(db_session, "b@example.com", "B")
    headers_b = {"Authorization": f"Bearer {token_b}"}
    
    # User A creates resources
    sem = client.post("/semesters", json={"name": "Sem A", "academic_year": "2026"}, headers=headers_a).json()
    sub = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Sub A"}, headers=headers_a).json()
    ass = client.post(f"/subjects/{sub['id']}/assessments", json={"name": "Ass A", "category": "quiz", "max_marks": 10}, headers=headers_a).json()
    att = client.post(f"/subjects/{sub['id']}/attendance", json={"classes_attended": 1, "classes_held": 1, "recorded_on": "2026-10-01"}, headers=headers_a).json()
    
    # 11-14. User B attempts to access User A's resources
    assert client.get(f"/semesters/{sem['id']}", headers=headers_b).status_code == 404
    assert client.get(f"/subjects/{sub['id']}", headers=headers_b).status_code == 404
    assert client.get(f"/assessments/{ass['id']}", headers=headers_b).status_code == 404
    assert client.get(f"/attendance/{att['id']}", headers=headers_b).status_code == 404
    
    assert client.put(f"/semesters/{sem['id']}", json={"name": "Hacked"}, headers=headers_b).status_code == 404
    assert client.delete(f"/subjects/{sub['id']}", headers=headers_b).status_code == 404
    
    # 16. Invalid IDs
    import uuid
    random_id = str(uuid.uuid4())
    assert client.get(f"/semesters/{random_id}", headers=headers_a).status_code == 404
    
    # 17. Deletion Cascades
    client.delete(f"/semesters/{sem['id']}", headers=headers_a)
    
    # DB check for cascades
    assert db_session.query(Semester).filter_by(id=sem['id']).count() == 0
    assert db_session.query(Subject).filter_by(id=sub['id']).count() == 0
    assert db_session.query(Assessment).filter_by(id=ass['id']).count() == 0
    assert db_session.query(Attendance).filter_by(id=att['id']).count() == 0

def test_idor_cross_user_creation_and_update(db_session):
    token_a, user_a = get_token_for_user(db_session, "a2@example.com", "A2")
    headers_a = {"Authorization": f"Bearer {token_a}"}
    
    token_b, user_b = get_token_for_user(db_session, "b2@example.com", "B2")
    headers_b = {"Authorization": f"Bearer {token_b}"}
    
    sem_a = client.post("/semesters", json={"name": "Sem A", "academic_year": "2026"}, headers=headers_a).json()
    sub_a = client.post(f"/semesters/{sem_a['id']}/subjects", json={"name": "Sub A"}, headers=headers_a).json()
    ass_a = client.post(f"/subjects/{sub_a['id']}/assessments", json={"name": "Ass A", "category": "quiz", "max_marks": 10, "weightage": 50}, headers=headers_a).json()
    
    # User B tries to create under User A's parents
    assert client.post(f"/semesters/{sem_a['id']}/subjects", json={"name": "Sub B"}, headers=headers_b).status_code == 404
    assert client.post(f"/subjects/{sub_a['id']}/assessments", json={"name": "Ass B", "category": "quiz", "max_marks": 10}, headers=headers_b).status_code == 404
    assert client.post(f"/subjects/{sub_a['id']}/attendance", json={"classes_attended": 1, "classes_held": 1, "recorded_on": "2026-10-01"}, headers=headers_b).status_code == 404
    
    # Test updating weightage successfully without triggering 100% cap (since it ignores itself)
    resp = client.put(f"/assessments/{ass_a['id']}", json={"weightage": 60}, headers=headers_a)
    assert resp.status_code == 200
    assert resp.json()["weightage"] == "60.00"
    
    # Test updating weightage to an invalid amount
    resp = client.put(f"/assessments/{ass_a['id']}", json={"weightage": 101}, headers=headers_a)
    assert resp.status_code == 400

