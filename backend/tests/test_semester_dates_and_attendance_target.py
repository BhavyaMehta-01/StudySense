from datetime import date
from decimal import Decimal
import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import engine, Base, SessionLocal
from app.models import User
from app.config import settings
import jwt

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


def get_auth_headers(db_session, email: str = "date_tester@example.com") -> dict:
    from datetime import datetime, timezone, timedelta
    user = User(email=f"{uuid.uuid4()}_{email}", password_hash="hash", name="Date Tester")
    db_session.add(user)
    db_session.commit()
    expire = datetime.now(timezone.utc) + timedelta(minutes=60)
    token = jwt.encode({"sub": str(user.id), "exp": expire}, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}


class TestSemesterDatesFlow:
    def test_create_semester_without_dates(self, db_session):
        headers = get_auth_headers(db_session)
        res = client.post("/semesters", json={"name": "Sem No Dates", "academic_year": "2026-2027"}, headers=headers)
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["start_date"] is None
        assert data["end_date"] is None

    def test_create_semester_with_valid_dates(self, db_session):
        headers = get_auth_headers(db_session)
        res = client.post("/semesters", json={
            "name": "Sem With Dates",
            "academic_year": "2026-2027",
            "start_date": "2026-09-01",
            "end_date": "2026-12-20",
        }, headers=headers)
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["start_date"] == "2026-09-01"
        assert data["end_date"] == "2026-12-20"

    def test_create_semester_with_invalid_date_order(self, db_session):
        headers = get_auth_headers(db_session)
        res = client.post("/semesters", json={
            "name": "Sem Bad Dates",
            "academic_year": "2026-2027",
            "start_date": "2026-12-20",
            "end_date": "2026-09-01",
        }, headers=headers)
        assert res.status_code == 422, res.text

    def test_update_semester_dates_valid_and_invalid(self, db_session):
        headers = get_auth_headers(db_session)
        res = client.post("/semesters", json={
            "name": "Sem To Update",
            "academic_year": "2026-2027",
            "start_date": "2026-09-01",
            "end_date": "2026-12-20",
        }, headers=headers)
        sem_id = res.json()["id"]

        # Valid update of end_date
        res2 = client.put(f"/semesters/{sem_id}", json={"end_date": "2026-12-25"}, headers=headers)
        assert res2.status_code == 200
        assert res2.json()["end_date"] == "2026-12-25"

        # Invalid update of end_date before existing start_date (cross-field check)
        res3 = client.put(f"/semesters/{sem_id}", json={"end_date": "2026-08-15"}, headers=headers)
        assert res3.status_code == 400


class TestSubjectAttendanceTarget:
    def test_default_attendance_target_is_75(self, db_session):
        headers = get_auth_headers(db_session)
        sem_res = client.post("/semesters", json={"name": "Att Sem", "academic_year": "2026-2027"}, headers=headers)
        sem_id = sem_res.json()["id"]

        sub_res = client.post(f"/semesters/{sem_id}/subjects", json={
            "name": "Physics",
            "target_percentage": 90
        }, headers=headers)
        assert sub_res.status_code == 200
        data = sub_res.json()
        assert data["target_percentage"] == 90
        assert data["attendance_target_percentage"] == 75

    def test_custom_attendance_target_percentage(self, db_session):
        headers = get_auth_headers(db_session)
        sem_res = client.post("/semesters", json={"name": "Att Sem 2", "academic_year": "2026-2027"}, headers=headers)
        sem_id = sem_res.json()["id"]

        sub_res = client.post(f"/semesters/{sem_id}/subjects", json={
            "name": "Chemistry",
            "target_percentage": 85,
            "attendance_target_percentage": 80,
        }, headers=headers)
        assert sub_res.status_code == 200
        data = sub_res.json()
        assert data["target_percentage"] == 85
        assert data["attendance_target_percentage"] == 80

    def test_attendance_target_percentage_boundary_validation(self, db_session):
        headers = get_auth_headers(db_session)
        sem_res = client.post("/semesters", json={"name": "Att Sem 3", "academic_year": "2026-2027"}, headers=headers)
        sem_id = sem_res.json()["id"]

        # > 100 invalid
        res1 = client.post(f"/semesters/{sem_id}/subjects", json={
            "name": "Math",
            "attendance_target_percentage": 105,
        }, headers=headers)
        assert res1.status_code == 422

        # < 0 invalid
        res2 = client.post(f"/semesters/{sem_id}/subjects", json={
            "name": "Math",
            "attendance_target_percentage": -5,
        }, headers=headers)
        assert res2.status_code == 422

        # 0 and 100 valid
        res_zero = client.post(f"/semesters/{sem_id}/subjects", json={
            "name": "Math Zero",
            "attendance_target_percentage": 0,
        }, headers=headers)
        assert res_zero.status_code == 200
        assert res_zero.json()["attendance_target_percentage"] == 0

        res_hundred = client.post(f"/semesters/{sem_id}/subjects", json={
            "name": "Math Hundred",
            "attendance_target_percentage": 100,
        }, headers=headers)
        assert res_hundred.status_code == 200
        assert res_hundred.json()["attendance_target_percentage"] == 100
