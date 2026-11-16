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

    # subject update (name, code, credits, target_percentage)
    update_sub_resp = client.put(
        f"/subjects/{sub_id}",
        json={"name": "Advanced Math", "code": "M201", "credits": 4.0, "target_percentage": 85},
        headers=headers,
    )
    assert update_sub_resp.status_code == 200
    updated_sub = update_sub_resp.json()
    assert updated_sub["name"] == "Advanced Math"
    assert updated_sub["code"] == "M201"
    assert float(updated_sub["credits"]) == 4.0
    assert updated_sub["target_percentage"] == 85

    # invalid target_percentage (> 100) rejected with 422
    bad_target_resp = client.put(
        f"/subjects/{sub_id}",
        json={"target_percentage": 105},
        headers=headers,
    )
    assert bad_target_resp.status_code == 422

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

    # assessment validation (rejected with 422 at API boundary)
    bad_ass_resp = client.post(
        f"/subjects/{sub_id}/assessments",
        json={"name": "Bad", "category": "invalid_category", "max_marks": 10},
        headers=headers
    )
    assert bad_ass_resp.status_code == 422

    # scored assessment without marks should be rejected (422 from Pydantic)
    scored_no_marks_resp = client.post(
        f"/subjects/{sub_id}/assessments",
        json={"name": "Bad Scored", "category": "midsem", "max_marks": 100, "status": "scored", "marks": None},
        headers=headers
    )
    assert scored_no_marks_resp.status_code == 422
    assert "Marks are required when status is 'scored'" in str(scored_no_marks_resp.json())

    # pending assessment without marks should be accepted
    pending_no_marks_resp = client.post(
        f"/subjects/{sub_id}/assessments",
        json={"name": "Good Pending", "category": "midsem", "max_marks": 100, "status": "pending", "marks": None},
        headers=headers
    )
    assert pending_no_marks_resp.status_code == 200


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
    assert client.put(f"/subjects/{sub['id']}", json={"name": "Hacked Sub"}, headers=headers_b).status_code == 404
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

def test_activate_semester(db_session):
    token_a, user_a = get_token_for_user(db_session, "active1@example.com", "Active 1")
    headers_a = {"Authorization": f"Bearer {token_a}"}

    token_b, user_b = get_token_for_user(db_session, "active2@example.com", "Active 2")
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # User A creates two semesters
    sem_a1 = client.post("/semesters", json={"name": "Sem A1", "academic_year": "2026"}, headers=headers_a).json()
    sem_a2 = client.post("/semesters", json={"name": "Sem A2", "academic_year": "2026"}, headers=headers_a).json()

    # User B creates one semester
    sem_b1 = client.post("/semesters", json={"name": "Sem B1", "academic_year": "2026"}, headers=headers_b).json()

    # Both default to inactive
    assert not sem_a1.get("is_active")
    assert not sem_a2.get("is_active")

    # User A activates sem_a1
    resp = client.patch(f"/semesters/{sem_a1['id']}/activate", headers=headers_a)
    assert resp.status_code == 200
    assert resp.json()["is_active"] is True

    # User A activates sem_a2 -> sem_a1 should become inactive
    resp = client.patch(f"/semesters/{sem_a2['id']}/activate", headers=headers_a)
    assert resp.status_code == 200
    assert resp.json()["is_active"] is True

    # Check sem_a1 is now inactive
    sem_a1_updated = client.get(f"/semesters/{sem_a1['id']}", headers=headers_a).json()
    assert sem_a1_updated["is_active"] is False

    # User B activates sem_b1 -> should not affect A
    client.patch(f"/semesters/{sem_b1['id']}/activate", headers=headers_b)
    sem_b1_updated = client.get(f"/semesters/{sem_b1['id']}", headers=headers_b).json()
    assert sem_b1_updated["is_active"] is True

    sem_a2_updated = client.get(f"/semesters/{sem_a2['id']}", headers=headers_a).json()
    assert sem_a2_updated["is_active"] is True

    # User A tries to activate User B's semester -> 404
    resp = client.patch(f"/semesters/{sem_b1['id']}/activate", headers=headers_a)
    assert resp.status_code == 404

def test_activation_rollback(db_session):
    token, user_id = get_token_for_user(db_session, "rollback@example.com", "Rollback")
    headers = {"Authorization": f"Bearer {token}"}

    sem1 = client.post("/semesters", json={"name": "Sem 1", "academic_year": "2026"}, headers=headers).json()
    sem2 = client.post("/semesters", json={"name": "Sem 2", "academic_year": "2026"}, headers=headers).json()

    # Activate sem1
    client.patch(f"/semesters/{sem1['id']}/activate", headers=headers)
    assert client.get(f"/semesters/{sem1['id']}", headers=headers).json()["is_active"] is True

    # Force a failure on activate sem2 by patching the database commit
    from unittest.mock import patch
    from sqlalchemy.exc import IntegrityError

    with patch("sqlalchemy.orm.Session.commit", side_effect=IntegrityError("forced error", params=None, orig=None)):
        resp = client.patch(f"/semesters/{sem2['id']}/activate", headers=headers)
        assert resp.status_code == 409

    # Verify sem1 is still active
    assert client.get(f"/semesters/{sem1['id']}", headers=headers).json()["is_active"] is True
    assert client.get(f"/semesters/{sem2['id']}", headers=headers).json()["is_active"] is False


def test_assessment_category_validation_and_valid_categories(db_session):
    token, user = get_token_for_user(db_session, "categories@example.com", "Cat User")
    headers = {"Authorization": f"Bearer {token}"}

    sem = client.post("/semesters", json={"name": "Sem Cat", "academic_year": "2026"}, headers=headers).json()
    sub = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Sub Cat"}, headers=headers).json()

    valid_categories = [
        "internal_test",
        "assignment",
        "quiz",
        "practical",
        "viva",
        "project",
        "midsem",
        "endsem",
        "other",
    ]

    # Verify all 9 canonical categories can be created
    created_ids = []
    for cat in valid_categories:
        resp = client.post(
            f"/subjects/{sub['id']}/assessments",
            json={"name": f"Test {cat}", "category": cat, "max_marks": 50, "weightage": 5},
            headers=headers,
        )
        assert resp.status_code == 200, f"Failed to create assessment with category {cat}: {resp.text}"
        data = resp.json()
        assert data["category"] == cat
        created_ids.append(data["id"])

    # Verify invalid category is rejected with HTTP 422 on creation
    for invalid_cat in ["Internal", "Exam", "homework", "midterm", ""]:
        bad_resp = client.post(
            f"/subjects/{sub['id']}/assessments",
            json={"name": "Invalid Cat", "category": invalid_cat, "max_marks": 50},
            headers=headers,
        )
        assert bad_resp.status_code == 422, f"Expected 422 for category '{invalid_cat}', got {bad_resp.status_code}"

    # Verify invalid category is rejected with HTTP 422 on update
    bad_update = client.put(
        f"/assessments/{created_ids[0]}",
        json={"category": "not_a_category"},
        headers=headers,
    )
    assert bad_update.status_code == 422

    # Verify valid category can be updated
    good_update = client.put(
        f"/assessments/{created_ids[0]}",
        json={"category": "assignment"},
        headers=headers,
    )
    assert good_update.status_code == 200
    assert good_update.json()["category"] == "assignment"


def test_subject_deletion_cascade(db_session):
    token, user_id = get_token_for_user(db_session, "cascade_test@example.com", "Cascade User")
    headers = {"Authorization": f"Bearer {token}"}

    # Create semester
    sem_resp = client.post(
        "/semesters",
        json={"name": "Semester Cascade", "academic_year": "2026-2027"},
        headers=headers,
    )
    assert sem_resp.status_code == 200
    sem_id = sem_resp.json()["id"]

    # Create subject
    sub_resp = client.post(
        f"/semesters/{sem_id}/subjects",
        json={"name": "Cascade Test", "code": "CT101", "credits": 4.0},
        headers=headers,
    )
    assert sub_resp.status_code == 200
    sub_id = sub_resp.json()["id"]

    # Create assessment
    ass_resp = client.post(
        f"/subjects/{sub_id}/assessments",
        json={"name": "Test Assessment", "category": "quiz", "max_marks": 25, "weightage": 15},
        headers=headers,
    )
    assert ass_resp.status_code == 200
    ass_id = ass_resp.json()["id"]

    # Create attendance
    att_resp = client.post(
        f"/subjects/{sub_id}/attendance",
        json={"classes_attended": 4, "classes_held": 5, "recorded_on": "2026-11-01"},
        headers=headers,
    )
    assert att_resp.status_code == 200
    att_id = att_resp.json()["id"]

    # Pre-condition check in DB
    assert db_session.query(Subject).filter_by(id=sub_id).count() == 1
    assert db_session.query(Assessment).filter_by(id=ass_id).count() == 1
    assert db_session.query(Attendance).filter_by(id=att_id).count() == 1

    # Delete subject via authenticated DELETE API endpoint
    del_resp = client.delete(f"/subjects/{sub_id}", headers=headers)
    assert del_resp.status_code == 204

    # Confirm subject no longer exists
    assert db_session.query(Subject).filter_by(id=sub_id).count() == 0
    # Confirm child assessment and attendance were cascaded
    assert db_session.query(Assessment).filter_by(id=ass_id).count() == 0
    assert db_session.query(Attendance).filter_by(id=att_id).count() == 0

    # Confirm GET on deleted subject returns 404
    assert client.get(f"/subjects/{sub_id}", headers=headers).status_code == 404
    # Confirm parent semester still exists
    assert db_session.query(Semester).filter_by(id=sem_id).count() == 1


def test_semester_deletion_cascade(db_session):
    # Owner user
    token_owner, owner_id = get_token_for_user(db_session, "sem_cascade_owner@example.com", "Sem Cascade Owner")
    headers_owner = {"Authorization": f"Bearer {token_owner}"}

    # Non-owner user to test ownership protection
    token_other, other_id = get_token_for_user(db_session, "sem_cascade_other@example.com", "Sem Cascade Other")
    headers_other = {"Authorization": f"Bearer {token_other}"}

    # 1. Create semester
    sem_resp = client.post(
        "/semesters",
        json={"name": "Semester Cascade Test", "academic_year": "2026-2027"},
        headers=headers_owner,
    )
    assert sem_resp.status_code == 200
    sem_id = sem_resp.json()["id"]

    # 2. Create subject under that semester
    sub_resp = client.post(
        f"/semesters/{sem_id}/subjects",
        json={"name": "Semester Cascade Subject", "code": "SC101", "credits": 4.0},
        headers=headers_owner,
    )
    assert sub_resp.status_code == 200
    sub_id = sub_resp.json()["id"]

    # 3. Create assessment under that subject
    ass_resp = client.post(
        f"/subjects/{sub_id}/assessments",
        json={"name": "Cascade Assessment", "category": "midsem", "max_marks": 100, "weightage": 30},
        headers=headers_owner,
    )
    assert ass_resp.status_code == 200
    ass_id = ass_resp.json()["id"]

    # 4. Create attendance record under that subject
    att_resp = client.post(
        f"/subjects/{sub_id}/attendance",
        json={"classes_attended": 4, "classes_held": 5, "recorded_on": "2026-11-02"},
        headers=headers_owner,
    )
    assert att_resp.status_code == 200
    att_id = att_resp.json()["id"]

    # 5. Pre-condition DB checks
    assert db_session.query(Semester).filter_by(id=sem_id).count() == 1
    assert db_session.query(Subject).filter_by(id=sub_id).count() == 1
    assert db_session.query(Assessment).filter_by(id=ass_id).count() == 1
    assert db_session.query(Attendance).filter_by(id=att_id).count() == 1

    # 6. Verify ownership protection: non-owner cannot delete semester
    unauth_del_resp = client.delete(f"/semesters/{sem_id}", headers=headers_other)
    assert unauth_del_resp.status_code == 404
    assert db_session.query(Semester).filter_by(id=sem_id).count() == 1

    # 7. Delete semester as owner
    del_resp = client.delete(f"/semesters/{sem_id}", headers=headers_owner)
    assert del_resp.status_code == 204

    # 8. Confirm DB records are all deleted across every level
    assert db_session.query(Semester).filter_by(id=sem_id).count() == 0
    assert db_session.query(Subject).filter_by(id=sub_id).count() == 0
    assert db_session.query(Assessment).filter_by(id=ass_id).count() == 0
    assert db_session.query(Attendance).filter_by(id=att_id).count() == 0

    # 9. Verify retrieving the deleted semester returns HTTP 404
    assert client.get(f"/semesters/{sem_id}", headers=headers_owner).status_code == 404
    # Also verify child resources return 404 via API
    assert client.get(f"/subjects/{sub_id}", headers=headers_owner).status_code == 404
    assert client.get(f"/assessments/{ass_id}", headers=headers_owner).status_code == 404
    assert client.get(f"/attendance/{att_id}", headers=headers_owner).status_code == 404


def test_assessment_status_and_marks_rules(db_session):
    token, user = get_token_for_user(db_session, "rules@example.com", "Rules User")
    headers = {"Authorization": f"Bearer {token}"}

    sem = client.post("/semesters", json={"name": "Sem Rules", "academic_year": "2026"}, headers=headers).json()
    sub = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Sub Rules"}, headers=headers).json()

    # 1. Pending assessments must not contain marks
    res_pending = client.post(
        f"/subjects/{sub['id']}/assessments",
        json={"name": "P1", "category": "quiz", "max_marks": 20, "marks": 10, "status": "pending"},
        headers=headers,
    )
    assert res_pending.status_code == 422
    assert "Pending assessments must not contain marks" in str(res_pending.json())

    # 2. Absent assessments must not contain marks
    res_absent = client.post(
        f"/subjects/{sub['id']}/assessments",
        json={"name": "A1", "category": "quiz", "max_marks": 20, "marks": 10, "status": "absent"},
        headers=headers,
    )
    assert res_absent.status_code == 422
    assert "Absent assessments must not contain marks" in str(res_absent.json())

    # 2b. Exempt assessments must not contain marks
    res_exempt_with_marks = client.post(
        f"/subjects/{sub['id']}/assessments",
        json={"name": "E1", "category": "quiz", "max_marks": 20, "marks": 10, "status": "exempt"},
        headers=headers,
    )
    assert res_exempt_with_marks.status_code == 422
    assert "Exempt assessments must not contain marks" in str(res_exempt_with_marks.json())

    # Exempt without marks is accepted
    res_exempt = client.post(
        f"/subjects/{sub['id']}/assessments",
        json={"name": "Valid Exempt", "category": "quiz", "max_marks": 20, "weightage": 5, "status": "exempt"},
        headers=headers,
    )
    assert res_exempt.status_code == 200
    assert res_exempt.json()["status"] == "exempt"
    assert res_exempt.json()["marks"] is None

    # 3. Scored assessments must have marks
    res_scored_no_marks = client.post(
        f"/subjects/{sub['id']}/assessments",
        json={"name": "S1", "category": "quiz", "max_marks": 20, "status": "scored"},
        headers=headers,
    )
    assert res_scored_no_marks.status_code == 422
    assert "Marks are required when status is 'scored'" in str(res_scored_no_marks.json())

    # Create a valid pending assessment
    ass_pending = client.post(
        f"/subjects/{sub['id']}/assessments",
        json={"name": "Valid Pending", "category": "quiz", "max_marks": 25, "weightage": 10, "status": "pending"},
        headers=headers,
    ).json()
    assert ass_pending["status"] == "pending"
    assert ass_pending["marks"] is None

    # 4. Entering marks for a Pending assessment automatically changes status to Scored
    res_promote = client.put(
        f"/assessments/{ass_pending['id']}",
        json={"marks": 20.5},
        headers=headers,
    )
    assert res_promote.status_code == 200
    data_promoted = res_promote.json()
    assert data_promoted["status"] == "scored"
    assert float(data_promoted["marks"]) == 20.5

    # 5. Changing an assessment to Pending clears its marks
    res_to_pending = client.put(
        f"/assessments/{ass_pending['id']}",
        json={"status": "pending"},
        headers=headers,
    )
    assert res_to_pending.status_code == 200
    data_pending = res_to_pending.json()
    assert data_pending["status"] == "pending"
    assert data_pending["marks"] is None

    # Change to scored again
    client.put(f"/assessments/{ass_pending['id']}", json={"marks": 15.0}, headers=headers)

    # 6. Changing an assessment to Absent clears its marks
    res_to_absent = client.put(
        f"/assessments/{ass_pending['id']}",
        json={"status": "absent"},
        headers=headers,
    )
    assert res_to_absent.status_code == 200
    data_absent = res_to_absent.json()
    assert data_absent["status"] == "absent"
    assert data_absent["marks"] is None

    # 7. Changing an assessment to Exempt clears its marks
    client.put(f"/assessments/{ass_pending['id']}", json={"marks": 18.0}, headers=headers)
    res_to_exempt = client.put(
        f"/assessments/{ass_pending['id']}",
        json={"status": "exempt"},
        headers=headers,
    )
    assert res_to_exempt.status_code == 200
    data_exempt = res_to_exempt.json()
    assert data_exempt["status"] == "exempt"
    assert data_exempt["marks"] is None

    # 8. Updating with explicit conflict is rejected
    res_conflict_pending = client.put(
        f"/assessments/{ass_pending['id']}",
        json={"status": "pending", "marks": 10.0},
        headers=headers,
    )
    assert res_conflict_pending.status_code == 422

    res_conflict_absent = client.put(
        f"/assessments/{ass_pending['id']}",
        json={"status": "absent", "marks": 10.0},
        headers=headers,
    )
    assert res_conflict_absent.status_code == 422

    res_conflict_exempt = client.put(
        f"/assessments/{ass_pending['id']}",
        json={"status": "exempt", "marks": 10.0},
        headers=headers,
    )
    assert res_conflict_exempt.status_code == 422

    # Updating Exempt with marks is rejected
    res_exempt_update_marks = client.put(
        f"/assessments/{res_exempt.json()['id']}",
        json={"marks": 15.0},
        headers=headers,
    )
    assert res_exempt_update_marks.status_code == 422

    # Partial update on Exempt preserves status and null marks
    res_exempt_partial = client.put(
        f"/assessments/{res_exempt.json()['id']}",
        json={"name": "Renamed Exempt"},
        headers=headers,
    )
    assert res_exempt_partial.status_code == 200
    assert res_exempt_partial.json()["name"] == "Renamed Exempt"
    assert res_exempt_partial.json()["status"] == "exempt"
    assert res_exempt_partial.json()["marks"] is None

    # Partial update on Scored preserves status and marks
    client.put(f"/assessments/{ass_pending['id']}", json={"status": "scored", "marks": 22.0}, headers=headers)
    res_scored_partial = client.put(
        f"/assessments/{ass_pending['id']}",
        json={"name": "Renamed Scored"},
        headers=headers,
    )
    assert res_scored_partial.status_code == 200
    assert res_scored_partial.json()["name"] == "Renamed Scored"
    assert res_scored_partial.json()["status"] == "scored"
    assert float(res_scored_partial.json()["marks"]) == 22.0


def test_numeric_increments_validation(db_session):
    token, user = get_token_for_user(db_session, "increments@example.com", "Incs User")
    headers = {"Authorization": f"Bearer {token}"}

    sem = client.post("/semesters", json={"name": "Sem Incs", "academic_year": "2026"}, headers=headers).json()

    # 1. Subject credits: whole numbers only (step 1)
    bad_cred_float = client.post(
        f"/semesters/{sem['id']}/subjects",
        json={"name": "Bad Credits", "credits": 3.5},
        headers=headers,
    )
    assert bad_cred_float.status_code == 422
    assert "whole number" in str(bad_cred_float.json())

    bad_cred_neg = client.post(
        f"/semesters/{sem['id']}/subjects",
        json={"name": "Neg Credits", "credits": -1},
        headers=headers,
    )
    assert bad_cred_neg.status_code == 422
    assert "greater than or equal to 0" in str(bad_cred_neg.json())

    good_sub = client.post(
        f"/semesters/{sem['id']}/subjects",
        json={"name": "Good Sub", "credits": 4},
        headers=headers,
    )
    assert good_sub.status_code == 200
    sub_id = good_sub.json()["id"]

    # Updating credits to invalid float is rejected
    bad_update_cred = client.put(f"/subjects/{sub_id}", json={"credits": 2.5}, headers=headers)
    assert bad_update_cred.status_code == 422

    # 2. Maximum marks: step 0.5 and > 0
    bad_max_step = client.post(
        f"/subjects/{sub_id}/assessments",
        json={"name": "Bad Max", "category": "quiz", "max_marks": 25.2},
        headers=headers,
    )
    assert bad_max_step.status_code == 422
    assert "increments of 0.5" in str(bad_max_step.json())

    bad_max_zero = client.post(
        f"/subjects/{sub_id}/assessments",
        json={"name": "Zero Max", "category": "quiz", "max_marks": 0},
        headers=headers,
    )
    assert bad_max_zero.status_code == 422

    # 3. Assessment weightage: step 0.5 and > 0
    bad_weight_step = client.post(
        f"/subjects/{sub_id}/assessments",
        json={"name": "Bad Weight", "category": "quiz", "max_marks": 50, "weightage": 15.25},
        headers=headers,
    )
    assert bad_weight_step.status_code == 422
    assert "increments of 0.5" in str(bad_weight_step.json())

    bad_weight_zero = client.post(
        f"/subjects/{sub_id}/assessments",
        json={"name": "Zero Weight", "category": "quiz", "max_marks": 50, "weightage": 0},
        headers=headers,
    )
    assert bad_weight_zero.status_code == 422

    # Valid assessment creation with 0.5 increments
    valid_ass = client.post(
        f"/subjects/{sub_id}/assessments",
        json={"name": "Valid Ass", "category": "midsem", "max_marks": 50.5, "weightage": 25.5, "status": "scored", "marks": 40.5},
        headers=headers,
    )
    assert valid_ass.status_code == 200
    ass_id = valid_ass.json()["id"]

    # 4. Marks scored: step 0.5, >= 0, <= max_marks
    bad_marks_step = client.put(f"/assessments/{ass_id}", json={"marks": 40.3}, headers=headers)
    assert bad_marks_step.status_code == 422
    assert "increments of 0.5" in str(bad_marks_step.json())

    bad_marks_neg = client.put(f"/assessments/{ass_id}", json={"marks": -0.5}, headers=headers)
    assert bad_marks_neg.status_code == 422

    bad_marks_over = client.put(f"/assessments/{ass_id}", json={"marks": 55.0}, headers=headers)
    assert bad_marks_over.status_code == 422
    assert "cannot exceed max marks" in str(bad_marks_over.json())


def test_attendance_validation(db_session):
    token, user = get_token_for_user(db_session, "att_val@example.com", "Att User")
    headers = {"Authorization": f"Bearer {token}"}

    sem = client.post("/semesters", json={"name": "Sem Att", "academic_year": "2026"}, headers=headers).json()
    sub = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Sub Att"}, headers=headers).json()
    sub_id = sub["id"]

    # 1. Create with classes_held=0 is rejected with 422
    res_held_zero = client.post(
        f"/subjects/{sub_id}/attendance",
        json={"classes_attended": 0, "classes_held": 0, "recorded_on": "2026-10-01"},
        headers=headers,
    )
    assert res_held_zero.status_code == 422

    # 2. Create with classes_attended < 0 is rejected with 422
    res_att_neg = client.post(
        f"/subjects/{sub_id}/attendance",
        json={"classes_attended": -1, "classes_held": 5, "recorded_on": "2026-10-01"},
        headers=headers,
    )
    assert res_att_neg.status_code == 422

    # 3. Create with attended > held is rejected with 422
    res_att_over = client.post(
        f"/subjects/{sub_id}/attendance",
        json={"classes_attended": 6, "classes_held": 5, "recorded_on": "2026-10-01"},
        headers=headers,
    )
    assert res_att_over.status_code == 422

    # 4. Create valid attendance
    res_valid = client.post(
        f"/subjects/{sub_id}/attendance",
        json={"classes_attended": 4, "classes_held": 5, "recorded_on": "2026-10-01"},
        headers=headers,
    )
    assert res_valid.status_code == 200
    att_id = res_valid.json()["id"]

    # 5. Exact reproduction: Edit attendance with classes_attended=0, classes_held=0 is rejected with 422
    res_edit_zeros = client.put(
        f"/attendance/{att_id}",
        json={"classes_attended": 0, "classes_held": 0},
        headers=headers,
    )
    assert res_edit_zeros.status_code == 422

    # 6. Verify existing attendance record is preserved
    res_get = client.get(f"/attendance/{att_id}", headers=headers)
    assert res_get.status_code == 200
    assert res_get.json()["classes_attended"] == 4
    assert res_get.json()["classes_held"] == 5

    # 7. Edit with classes_held=0 is rejected with 422
    res_edit_held_zero = client.put(
        f"/attendance/{att_id}",
        json={"classes_held": 0},
        headers=headers,
    )
    assert res_edit_held_zero.status_code == 422

    # 8. Edit with attended > held is rejected with 422
    res_edit_over = client.put(
        f"/attendance/{att_id}",
        json={"classes_attended": 6},
        headers=headers,
    )
    assert res_edit_over.status_code == 422

    # 9. Create with fractional classes_held (6.5) is rejected with 422
    res_held_frac = client.post(
        f"/subjects/{sub_id}/attendance",
        json={"classes_attended": 4, "classes_held": 6.5, "recorded_on": "2026-10-01"},
        headers=headers,
    )
    assert res_held_frac.status_code == 422
    assert "whole number" in res_held_frac.text

    # 10. Create with fractional classes_attended (2.5) is rejected with 422
    res_att_frac = client.post(
        f"/subjects/{sub_id}/attendance",
        json={"classes_attended": 2.5, "classes_held": 5, "recorded_on": "2026-10-01"},
        headers=headers,
    )
    assert res_att_frac.status_code == 422
    assert "whole number" in res_att_frac.text

    # 11. Edit with fractional classes_held (6.5) is rejected with 422
    res_edit_held_frac = client.put(
        f"/attendance/{att_id}",
        json={"classes_held": 6.5},
        headers=headers,
    )
    assert res_edit_held_frac.status_code == 422
    assert "whole number" in res_edit_held_frac.text

    # 12. Edit with fractional classes_attended (2.5) is rejected with 422
    res_edit_att_frac = client.put(
        f"/attendance/{att_id}",
        json={"classes_attended": 2.5},
        headers=headers,
    )
    assert res_edit_att_frac.status_code == 422
    assert "whole number" in res_edit_att_frac.text

    # 13. Valid edit succeeds
    res_edit_valid = client.put(
        f"/attendance/{att_id}",
        json={"classes_attended": 5, "classes_held": 5},
        headers=headers,
    )
    assert res_edit_valid.status_code == 200
    assert res_edit_valid.json()["classes_attended"] == 5
    assert res_edit_valid.json()["classes_held"] == 5


def test_duplicate_assessment_name_prevention(db_session):
    token, user_id = get_token_for_user(db_session, "dup_assessment@example.com", "Dup User")
    headers = {"Authorization": f"Bearer {token}"}

    # Setup semester and two subjects
    sem_resp = client.post("/semesters", json={"name": "Sem 4", "academic_year": "2026"}, headers=headers)
    assert sem_resp.status_code == 200
    sem_id = sem_resp.json()["id"]

    sub1_resp = client.post(f"/semesters/{sem_id}/subjects", json={"name": "Digital Electronics", "code": "DE101"}, headers=headers)
    assert sub1_resp.status_code == 200
    sub1_id = sub1_resp.json()["id"]

    sub2_resp = client.post(f"/semesters/{sem_id}/subjects", json={"name": "Signals and Systems", "code": "SS101"}, headers=headers)
    assert sub2_resp.status_code == 200
    sub2_id = sub2_resp.json()["id"]

    # 1. Create first assessment in subject 1
    ass1_payload = {
        "name": "Digital Electronics Test 1",
        "category": "internal_test",
        "max_marks": 25,
        "weightage": 20,
        "status": "pending",
    }
    res_create1 = client.post(f"/subjects/{sub1_id}/assessments", json=ass1_payload, headers=headers)
    assert res_create1.status_code == 200
    ass1_id = res_create1.json()["id"]

    # 2. Reject exact duplicate creation within same subject (409)
    res_create_exact_dup = client.post(f"/subjects/{sub1_id}/assessments", json=ass1_payload, headers=headers)
    assert res_create_exact_dup.status_code == 409
    assert "already exists in this subject" in res_create_exact_dup.json()["detail"]

    # 3. Reject case-insensitive duplicate creation within same subject (409)
    ass_case_dup = {**ass1_payload, "name": "digital electronics test 1"}
    res_create_case_dup = client.post(f"/subjects/{sub1_id}/assessments", json=ass_case_dup, headers=headers)
    assert res_create_case_dup.status_code == 409
    assert "already exists in this subject" in res_create_case_dup.json()["detail"]

    # 4. Reject trimmed whitespace duplicate creation within same subject (409)
    ass_trim_dup = {**ass1_payload, "name": "   Digital Electronics Test 1   "}
    res_create_trim_dup = client.post(f"/subjects/{sub1_id}/assessments", json=ass_trim_dup, headers=headers)
    assert res_create_trim_dup.status_code == 409
    assert "already exists in this subject" in res_create_trim_dup.json()["detail"]

    # 5. Allow identical name in a DIFFERENT subject
    res_create_sub2 = client.post(f"/subjects/{sub2_id}/assessments", json=ass1_payload, headers=headers)
    assert res_create_sub2.status_code == 200
    assert res_create_sub2.json()["name"] == "Digital Electronics Test 1"

    # 6. Create second assessment in subject 1
    ass2_payload = {
        "name": "Digital Electronics Test 2",
        "category": "internal_test",
        "max_marks": 25,
        "weightage": 20,
        "status": "pending",
    }
    res_create2 = client.post(f"/subjects/{sub1_id}/assessments", json=ass2_payload, headers=headers)
    assert res_create2.status_code == 200
    ass2_id = res_create2.json()["id"]

    # 7. Reject duplicate name during editing (renaming Test 2 to Test 1) (409)
    res_edit_dup = client.put(
        f"/assessments/{ass2_id}",
        json={"name": "Digital Electronics Test 1"},
        headers=headers,
    )
    assert res_edit_dup.status_code == 409
    assert "already exists in this subject" in res_edit_dup.json()["detail"]

    # 8. Reject duplicate name during editing with case/whitespace variations (409)
    res_edit_case_dup = client.put(
        f"/assessments/{ass2_id}",
        json={"name": "  digital electronics test 1  "},
        headers=headers,
    )
    assert res_edit_case_dup.status_code == 409
    assert "already exists in this subject" in res_edit_case_dup.json()["detail"]

    # 9. Allow editing assessment while retaining its existing name
    res_edit_retain_name = client.put(
        f"/assessments/{ass1_id}",
        json={"name": "Digital Electronics Test 1", "marks": 20, "status": "scored"},
        headers=headers,
    )
    assert res_edit_retain_name.status_code == 200
    assert res_edit_retain_name.json()["name"] == "Digital Electronics Test 1"
    assert float(res_edit_retain_name.json()["marks"]) == 20.0

    # 10. Allow editing without providing name field at all
    res_edit_no_name = client.put(
        f"/assessments/{ass2_id}",
        json={"status": "absent"},
        headers=headers,
    )
    assert res_edit_no_name.status_code == 200
    assert res_edit_no_name.json()["status"] == "absent"
    assert res_edit_no_name.json()["name"] == "Digital Electronics Test 2"

