from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import engine, Base, SessionLocal
from app.models import User, Assessment, AssessmentPattern, AssessmentPatternComponent, AcademicCalendarEvent
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


def create_authenticated_user(db_session, email_prefix: str = "user") -> tuple[dict, User]:
    user = User(email=f"{uuid.uuid4()}_{email_prefix}@example.com", password_hash="hash", name="User")
    db_session.add(user)
    db_session.commit()
    expire = datetime.now(timezone.utc) + timedelta(minutes=60)
    token = jwt.encode({"sub": str(user.id), "exp": expire}, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}, user


def setup_user_and_subject(db_session, user_prefix: str = "u"):
    headers, user = create_authenticated_user(db_session, user_prefix)
    sem = client.post(
        "/semesters",
        json={"name": "Sem 1", "academic_year": "2026-2027"},
        headers=headers,
    ).json()
    subj = client.post(
        f"/semesters/{sem['id']}/subjects",
        json={"name": "Data Structures", "code": "CS201"},
        headers=headers,
    ).json()
    return headers, user, sem["id"], subj["id"]


# ==============================================================================
# GET /subjects/{subject_id}/pattern tests
# ==============================================================================

class TestGetAssessmentPattern:
    def test_retrieve_active_pattern_with_ordered_components(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "get_active")

        # Create pattern with components in non-sequential order to test ordering
        create_res = client.post(
            f"/subjects/{subj_id}/pattern",
            json={
                "name": "Engineering Standard",
                "is_active": True,
                "components": [
                    {
                        "name": "End-Sem",
                        "category": "endsem",
                        "max_marks": "100.0",
                        "weightage": "50.0",
                        "is_active": True,
                        "order_index": 2,
                    },
                    {
                        "name": "Mid-Sem",
                        "category": "midsem",
                        "max_marks": "50.0",
                        "weightage": "30.0",
                        "is_active": True,
                        "order_index": 1,
                    },
                    {
                        "name": "Quiz 1",
                        "category": "quiz",
                        "max_marks": "20.0",
                        "weightage": "20.0",
                        "is_active": True,
                        "order_index": 0,
                    },
                ],
            },
            headers=headers,
        )
        assert create_res.status_code == 201

        # GET request
        res = client.get(f"/subjects/{subj_id}/pattern", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data is not None
        assert data["name"] == "Engineering Standard"
        assert data["is_active"] is True
        assert len(data["components"]) == 3
        # Verify components ordered by order_index: 0, 1, 2
        assert [c["name"] for c in data["components"]] == ["Quiz 1", "Mid-Sem", "End-Sem"]
        assert [c["order_index"] for c in data["components"]] == [0, 1, 2]

    def test_retrieve_subject_with_no_active_pattern_returns_200_null(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "get_none")
        res = client.get(f"/subjects/{subj_id}/pattern", headers=headers)
        assert res.status_code == 200
        assert res.json() is None

    def test_reject_unauthenticated_get(self, db_session):
        fake_subj = uuid.uuid4()
        res = client.get(f"/subjects/{fake_subj}/pattern")
        assert res.status_code in (401, 403)

    def test_reject_get_another_users_subject(self, db_session):
        headers_a, _, _, subj_a = setup_user_and_subject(db_session, "user_a")
        headers_b, _, _, _ = setup_user_and_subject(db_session, "user_b")

        # Create pattern for User A
        client.post(
            f"/subjects/{subj_a}/pattern",
            json={"name": "Pattern A", "is_active": True},
            headers=headers_a,
        )

        # User B attempts to access User A's subject pattern
        res = client.get(f"/subjects/{subj_a}/pattern", headers=headers_b)
        assert res.status_code == 404
        assert "not found" in res.json()["detail"].lower()

    def test_reject_get_nonexistent_subject(self, db_session):
        headers, _, _, _ = setup_user_and_subject(db_session, "get_nonexist")
        res = client.get(f"/subjects/{uuid.uuid4()}/pattern", headers=headers)
        assert res.status_code == 404


# ==============================================================================
# POST /subjects/{subject_id}/pattern tests
# ==============================================================================

class TestCreateAssessmentPattern:
    def test_create_pattern_with_multiple_components_success(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "create_multi")

        payload = {
            "name": "Standard Pattern",
            "is_active": True,
            "components": [
                {
                    "name": "Mid-Sem Exam",
                    "category": "midsem",
                    "max_marks": "100.0",
                    "weightage": "30.0",
                    "is_active": True,
                    "order_index": 0,
                },
                {
                    "name": "Practical Lab",
                    "category": "practical",
                    "max_marks": "50.0",
                    "weightage": "20.0",
                    "is_active": True,
                    "order_index": 1,
                },
                {
                    "name": "End-Sem Exam",
                    "category": "endsem",
                    "max_marks": "100.0",
                    "weightage": "50.0",
                    "is_active": True,
                    "order_index": 2,
                },
            ],
        }
        res = client.post(f"/subjects/{subj_id}/pattern", json=payload, headers=headers)
        assert res.status_code == 201
        data = res.json()
        assert data["name"] == "Standard Pattern"
        assert data["is_active"] is True
        assert len(data["components"]) == 3
        assert Decimal(data["components"][0]["weightage"]) == Decimal("30.00")
        assert Decimal(data["components"][1]["weightage"]) == Decimal("20.00")
        assert Decimal(data["components"][2]["weightage"]) == Decimal("50.00")

    def test_create_pattern_without_components(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "create_empty")
        res = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Empty Pattern", "is_active": True},
            headers=headers,
        )
        assert res.status_code == 201
        data = res.json()
        assert data["name"] == "Empty Pattern"
        assert data["components"] == []

    def test_reject_second_active_pattern_with_409(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "create_conflict")

        res1 = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Active Pattern 1", "is_active": True},
            headers=headers,
        )
        assert res1.status_code == 201

        # Attempt to create a second active pattern for the same subject
        res2 = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Active Pattern 2", "is_active": True},
            headers=headers,
        )
        assert res2.status_code == 409
        assert "already exists" in res2.json()["detail"].lower()

        # Creating an inactive pattern alongside an active pattern should succeed
        res3 = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Draft Inactive Pattern", "is_active": False},
            headers=headers,
        )
        assert res3.status_code == 201
        assert res3.json()["is_active"] is False

    def test_reject_active_weightage_totals_above_100(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "overweight")
        payload = {
            "name": "Overweight Pattern",
            "is_active": True,
            "components": [
                {
                    "name": "Part 1",
                    "category": "midsem",
                    "max_marks": "100.0",
                    "weightage": "60.0",
                    "is_active": True,
                },
                {
                    "name": "Part 2",
                    "category": "endsem",
                    "max_marks": "100.0",
                    "weightage": "50.0",
                    "is_active": True,
                },
            ],
        }
        res = client.post(f"/subjects/{subj_id}/pattern", json=payload, headers=headers)
        assert res.status_code == 422
        assert "cannot exceed 100" in res.text

    def test_inactive_components_do_not_contribute_to_weightage_limit(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "inactive_weight")
        payload = {
            "name": "Pattern With Inactive Drafts",
            "is_active": True,
            "components": [
                {
                    "name": "Main Exam",
                    "category": "endsem",
                    "max_marks": "100.0",
                    "weightage": "100.0",
                    "is_active": True,
                },
                {
                    "name": "Optional Inactive Practical",
                    "category": "practical",
                    "max_marks": "50.0",
                    "weightage": "20.0",
                    "is_active": False,
                },
                {
                    "name": "Zero Weight Draft",
                    "category": "quiz",
                    "max_marks": "10.0",
                    "weightage": "0.0",
                    "is_active": False,
                },
            ],
        }
        res = client.post(f"/subjects/{subj_id}/pattern", json=payload, headers=headers)
        assert res.status_code == 201
        data = res.json()
        assert len(data["components"]) == 3

    def test_reject_invalid_component_data(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "bad_comp")

        # Active component with 0 weightage must be rejected
        res_zero = client.post(
            f"/subjects/{subj_id}/pattern",
            json={
                "name": "Bad Zero",
                "components": [
                    {
                        "name": "Zero Quiz",
                        "category": "quiz",
                        "max_marks": "20.0",
                        "weightage": "0.0",
                        "is_active": True,
                    }
                ],
            },
            headers=headers,
        )
        assert res_zero.status_code == 422

        # Component with max_marks <= 0 must be rejected
        res_neg_marks = client.post(
            f"/subjects/{subj_id}/pattern",
            json={
                "name": "Bad Marks",
                "components": [
                    {
                        "name": "Zero Max",
                        "category": "quiz",
                        "max_marks": "0.0",
                        "weightage": "10.0",
                    }
                ],
            },
            headers=headers,
        )
        assert res_neg_marks.status_code == 422

    def test_failed_creation_leaves_no_partial_records(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "atomic_test")

        initial_patterns = db_session.query(AssessmentPattern).count()
        initial_components = db_session.query(AssessmentPatternComponent).count()

        # Payload that fails validation in components
        payload = {
            "name": "Failing Pattern",
            "is_active": True,
            "components": [
                {
                    "name": "Valid Comp",
                    "category": "quiz",
                    "max_marks": "20.0",
                    "weightage": "20.0",
                    "is_active": True,
                },
                {
                    "name": "Invalid Comp",
                    "category": "quiz",
                    "max_marks": "-5.0",  # Invalid
                    "weightage": "20.0",
                    "is_active": True,
                },
            ],
        }
        res = client.post(f"/subjects/{subj_id}/pattern", json=payload, headers=headers)
        assert res.status_code == 422

        # Verify no records were inserted into the database
        assert db_session.query(AssessmentPattern).count() == initial_patterns
        assert db_session.query(AssessmentPatternComponent).count() == initial_components

    def test_reject_create_for_another_users_subject(self, db_session):
        headers_a, _, _, subj_a = setup_user_and_subject(db_session, "cross_create_a")
        headers_b, _, _, _ = setup_user_and_subject(db_session, "cross_create_b")

        res = client.post(
            f"/subjects/{subj_a}/pattern",
            json={"name": "Attacker Pattern", "is_active": True},
            headers=headers_b,
        )
        assert res.status_code == 404

    def test_reject_unauthenticated_create(self, db_session):
        res = client.post(f"/subjects/{uuid.uuid4()}/pattern", json={"name": "Anon"})
        assert res.status_code in (401, 403)


# ==============================================================================
# PUT /subjects/{subject_id}/pattern/{pattern_id} tests
# ==============================================================================

class TestUpdateAssessmentPattern:
    def test_update_pattern_name_success(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "put_name")
        create_res = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Initial Name", "is_active": True},
            headers=headers,
        ).json()

        pat_id = create_res["id"]
        update_res = client.put(
            f"/subjects/{subj_id}/pattern/{pat_id}",
            json={"name": "Updated Name"},
            headers=headers,
        )
        assert update_res.status_code == 200
        assert update_res.json()["name"] == "Updated Name"
        assert update_res.json()["is_active"] is True

    def test_deactivate_and_activate_pattern(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "put_deact")
        create_res = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern A", "is_active": True},
            headers=headers,
        ).json()
        pat_id = create_res["id"]

        # 1. Deactivate
        res_deact = client.put(
            f"/subjects/{subj_id}/pattern/{pat_id}",
            json={"is_active": False},
            headers=headers,
        )
        assert res_deact.status_code == 200
        assert res_deact.json()["is_active"] is False

        # Active query should now return null
        get_res = client.get(f"/subjects/{subj_id}/pattern", headers=headers)
        assert get_res.json() is None

        # 2. Re-activate when no other active pattern exists
        res_act = client.put(
            f"/subjects/{subj_id}/pattern/{pat_id}",
            json={"is_active": True},
            headers=headers,
        )
        assert res_act.status_code == 200
        assert res_act.json()["is_active"] is True

    def test_reject_activating_pattern_when_another_active_pattern_exists(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "put_conflict")

        # Pattern 1 is active
        pat1 = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern 1 Active", "is_active": True},
            headers=headers,
        ).json()

        # Pattern 2 is inactive
        pat2 = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern 2 Inactive", "is_active": False},
            headers=headers,
        ).json()

        # Attempt to activate Pattern 2 -> should return 409
        res_act = client.put(
            f"/subjects/{subj_id}/pattern/{pat2['id']}",
            json={"is_active": True},
            headers=headers,
        )
        assert res_act.status_code == 409
        assert "already exists" in res_act.json()["detail"].lower()

        # Verify Pattern 1 remains active and Pattern 2 remains inactive
        active_res = client.get(f"/subjects/{subj_id}/pattern", headers=headers).json()
        assert active_res["id"] == pat1["id"]
        assert active_res["name"] == "Pattern 1 Active"

    def test_reject_updating_pattern_belonging_to_another_subject(self, db_session):
        headers, _, sem_id, subj_a = setup_user_and_subject(db_session, "subj_mismatch")
        subj_b = client.post(
            f"/semesters/{sem_id}/subjects",
            json={"name": "Other Subject"},
            headers=headers,
        ).json()["id"]

        pat_a = client.post(
            f"/subjects/{subj_a}/pattern",
            json={"name": "Pattern A", "is_active": True},
            headers=headers,
        ).json()["id"]

        # Attempt updating Pattern A using Subject B's URL path
        res = client.put(
            f"/subjects/{subj_b}/pattern/{pat_a}",
            json={"name": "Hijacked"},
            headers=headers,
        )
        assert res.status_code == 404

    def test_reject_updating_another_users_pattern(self, db_session):
        headers_a, _, _, subj_a = setup_user_and_subject(db_session, "put_user_a")
        headers_b, _, _, _ = setup_user_and_subject(db_session, "put_user_b")

        pat_a = client.post(
            f"/subjects/{subj_a}/pattern",
            json={"name": "Pattern A", "is_active": True},
            headers=headers_a,
        ).json()["id"]

        res = client.put(
            f"/subjects/{subj_a}/pattern/{pat_a}",
            json={"name": "Hacked"},
            headers=headers_b,
        )
        assert res.status_code == 404

    def test_reject_updating_nonexistent_pattern_id(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "put_nonexist")
        res = client.put(
            f"/subjects/{subj_id}/pattern/{uuid.uuid4()}",
            json={"name": "Ghost"},
            headers=headers,
        )
        assert res.status_code == 404


# ==============================================================================
# DELETE /subjects/{subject_id}/pattern/{pattern_id} tests
# ==============================================================================

class TestDeleteAssessmentPattern:
    def test_delete_pattern_and_cascade_components(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "del_cascade")

        created = client.post(
            f"/subjects/{subj_id}/pattern",
            json={
                "name": "To Be Deleted",
                "is_active": True,
                "components": [
                    {
                        "name": "Quiz 1",
                        "category": "quiz",
                        "max_marks": "20.0",
                        "weightage": "20.0",
                    }
                ],
            },
            headers=headers,
        ).json()
        pat_id = created["id"]
        comp_id = created["components"][0]["id"]

        # DELETE pattern
        del_res = client.delete(f"/subjects/{subj_id}/pattern/{pat_id}", headers=headers)
        assert del_res.status_code == 204

        # Verify active query returns null
        get_res = client.get(f"/subjects/{subj_id}/pattern", headers=headers)
        assert get_res.json() is None

        # Verify pattern and component are deleted from DB
        assert db_session.get(AssessmentPattern, uuid.UUID(pat_id)) is None
        assert db_session.get(AssessmentPatternComponent, uuid.UUID(comp_id)) is None

    def test_reject_delete_another_subjects_pattern(self, db_session):
        headers, _, sem_id, subj_a = setup_user_and_subject(db_session, "del_cross_sub")
        subj_b = client.post(
            f"/semesters/{sem_id}/subjects",
            json={"name": "Subject B"},
            headers=headers,
        ).json()["id"]

        pat_a = client.post(
            f"/subjects/{subj_a}/pattern",
            json={"name": "Pattern A", "is_active": True},
            headers=headers,
        ).json()["id"]

        res = client.delete(f"/subjects/{subj_b}/pattern/{pat_a}", headers=headers)
        assert res.status_code == 404

    def test_reject_delete_another_users_pattern(self, db_session):
        headers_a, _, _, subj_a = setup_user_and_subject(db_session, "del_user_a")
        headers_b, _, _, _ = setup_user_and_subject(db_session, "del_user_b")

        pat_a = client.post(
            f"/subjects/{subj_a}/pattern",
            json={"name": "Pattern A", "is_active": True},
            headers=headers_a,
        ).json()["id"]

        res = client.delete(f"/subjects/{subj_a}/pattern/{pat_a}", headers=headers_b)
        assert res.status_code == 404

    def test_reject_delete_nonexistent_pattern(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "del_nonexist")
        res = client.delete(f"/subjects/{subj_id}/pattern/{uuid.uuid4()}", headers=headers)
        assert res.status_code == 404

    def test_linked_assessments_survive_pattern_deletion(self, db_session):
        headers, _, sem_id, subj_id = setup_user_and_subject(db_session, "del_assessment_preserv")

        # 1. Create pattern with component
        created = client.post(
            f"/subjects/{subj_id}/pattern",
            json={
                "name": "Engineering Pattern",
                "is_active": True,
                "components": [
                    {
                        "name": "Mid-Sem",
                        "category": "midsem",
                        "max_marks": "100.0",
                        "weightage": "30.0",
                    }
                ],
            },
            headers=headers,
        ).json()
        pat_id = created["id"]
        comp_id = created["components"][0]["id"]

        # 2. Create an academic calendar event belonging to the semester
        cal_event = AcademicCalendarEvent(
            semester_id=uuid.UUID(sem_id),
            title="Mid-Sem Exam Period",
            event_type="exam",
            start_date=date(2026, 10, 15),
            end_date=date(2026, 10, 20),
            cancels_regular_classes=True,
        )
        db_session.add(cal_event)
        db_session.commit()
        cal_event_id = cal_event.id

        # 3. Create an auto-generated assessment linked to both pattern component and calendar event with scored marks
        assessment = Assessment(
            subject_id=uuid.UUID(subj_id),
            name="Mid-Sem Exam - DS",
            category="midsem",
            max_marks=Decimal("100.00"),
            marks=Decimal("84.50"),
            weightage=Decimal("30.00"),
            status="scored",
            pattern_component_id=uuid.UUID(comp_id),
            calendar_event_id=cal_event_id,
            is_auto_generated=True,
        )
        db_session.add(assessment)
        db_session.commit()
        assessment_id = assessment.id

        # 4. Delete the pattern
        del_res = client.delete(f"/subjects/{subj_id}/pattern/{pat_id}", headers=headers)
        assert del_res.status_code == 204

        # 5. Verify the assessment survives with marks, snapshot values, calendar_event_id, and is_auto_generated intact,
        # and only pattern_component_id becomes NULL
        db_session.expire_all()
        reloaded = db_session.get(Assessment, assessment_id)
        assert reloaded is not None
        assert reloaded.pattern_component_id is None
        assert reloaded.calendar_event_id == cal_event_id
        assert reloaded.is_auto_generated is True
        assert reloaded.name == "Mid-Sem Exam - DS"
        assert reloaded.category == "midsem"
        assert reloaded.max_marks == Decimal("100.00")
        assert reloaded.marks == Decimal("84.50")
        assert reloaded.weightage == Decimal("30.00")
        assert reloaded.status == "scored"

        # 6. Verify that the calendar event itself still exists
        reloaded_event = db_session.get(AcademicCalendarEvent, cal_event_id)
        assert reloaded_event is not None
        assert reloaded_event.id == cal_event_id
        assert reloaded_event.title == "Mid-Sem Exam Period"


# ==============================================================================
# POST /subjects/{subject_id}/pattern/{pattern_id}/components tests (Stage 4.2.1b)
# ==============================================================================

class TestCreatePatternComponent:
    def test_create_component_success_default_order(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "comp_create_def")
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern 1", "is_active": True},
            headers=headers,
        ).json()

        res1 = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Quiz 1",
                "category": "quiz",
                "max_marks": "20.0",
                "weightage": "20.0",
                "is_active": True,
            },
            headers=headers,
        )
        assert res1.status_code == 201
        data1 = res1.json()
        assert data1["name"] == "Quiz 1"
        assert Decimal(data1["max_marks"]) == Decimal("20.00")
        assert Decimal(data1["weightage"]) == Decimal("20.00")
        assert data1["is_active"] is True
        assert data1["order_index"] == 0

        # Create second component without specifying order_index -> should receive order_index = 1
        res2 = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Mid-Sem",
                "category": "midsem",
                "max_marks": "50.0",
                "weightage": "30.0",
                "is_active": True,
            },
            headers=headers,
        )
        assert res2.status_code == 201
        data2 = res2.json()
        assert data2["name"] == "Mid-Sem"
        assert data2["order_index"] == 1

    def test_create_component_with_explicit_order_index(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "comp_create_order")
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern", "is_active": True},
            headers=headers,
        ).json()

        res = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Custom Order Comp",
                "category": "assignment",
                "max_marks": "10.0",
                "weightage": "10.0",
                "order_index": 5,
            },
            headers=headers,
        )
        assert res.status_code == 201
        assert res.json()["order_index"] == 5

    def test_create_component_active_weightage_exactly_100_percent(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "comp_exact_100")
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={
                "name": "Pattern",
                "is_active": True,
                "components": [
                    {
                        "name": "Mid-Sem",
                        "category": "midsem",
                        "max_marks": "100.0",
                        "weightage": "40.0",
                    }
                ],
            },
            headers=headers,
        ).json()

        # Add component bringing active total to exactly 100% (40% + 60% = 100%)
        res = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "End-Sem",
                "category": "endsem",
                "max_marks": "100.0",
                "weightage": "60.0",
                "is_active": True,
            },
            headers=headers,
        )
        assert res.status_code == 201
        assert Decimal(res.json()["weightage"]) == Decimal("60.00")

    def test_reject_create_component_exceeding_100_percent_active_weightage(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "comp_over_100")
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={
                "name": "Pattern",
                "is_active": True,
                "components": [
                    {
                        "name": "Mid-Sem",
                        "category": "midsem",
                        "max_marks": "100.0",
                        "weightage": "60.0",
                    }
                ],
            },
            headers=headers,
        ).json()

        # Attempt to add component with 50% (60% + 50% = 110% > 100%)
        res = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "End-Sem",
                "category": "endsem",
                "max_marks": "100.0",
                "weightage": "50.0",
                "is_active": True,
            },
            headers=headers,
        )
        assert res.status_code == 422
        assert "cannot exceed 100" in res.text

    def test_reject_create_active_component_with_zero_weightage(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "comp_zero_weight")
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern", "is_active": True},
            headers=headers,
        ).json()

        res = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Zero Quiz",
                "category": "quiz",
                "max_marks": "20.0",
                "weightage": "0.0",
                "is_active": True,
            },
            headers=headers,
        )
        assert res.status_code == 422

    def test_create_inactive_component_with_zero_weightage_success(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "comp_inactive_zero")
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern", "is_active": True},
            headers=headers,
        ).json()

        res = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Draft Quiz",
                "category": "quiz",
                "max_marks": "20.0",
                "weightage": "0.0",
                "is_active": False,
            },
            headers=headers,
        )
        assert res.status_code == 201
        assert res.json()["is_active"] is False
        assert Decimal(res.json()["weightage"]) == Decimal("0.00")

    def test_reject_create_component_for_another_users_subject(self, db_session):
        headers_a, _, _, subj_a = setup_user_and_subject(db_session, "comp_user_a")
        headers_b, _, _, _ = setup_user_and_subject(db_session, "comp_user_b")
        pat_a = client.post(
            f"/subjects/{subj_a}/pattern",
            json={"name": "Pattern A", "is_active": True},
            headers=headers_a,
        ).json()

        res = client.post(
            f"/subjects/{subj_a}/pattern/{pat_a['id']}/components",
            json={
                "name": "Hacked Comp",
                "category": "quiz",
                "max_marks": "20.0",
                "weightage": "20.0",
            },
            headers=headers_b,
        )
        assert res.status_code == 404

    def test_reject_create_component_mismatched_pattern_and_subject(self, db_session):
        headers, _, sem_id, subj_a = setup_user_and_subject(db_session, "comp_mismatch_a")
        subj_b = client.post(
            f"/semesters/{sem_id}/subjects",
            json={"name": "Subject B"},
            headers=headers,
        ).json()["id"]
        pat_a = client.post(
            f"/subjects/{subj_a}/pattern",
            json={"name": "Pattern A", "is_active": True},
            headers=headers,
        ).json()["id"]

        # Attempt to create component under Subject B URL path with Pattern A's ID
        res = client.post(
            f"/subjects/{subj_b}/pattern/{pat_a}/components",
            json={
                "name": "Mismatched Comp",
                "category": "quiz",
                "max_marks": "20.0",
                "weightage": "20.0",
            },
            headers=headers,
        )
        assert res.status_code == 404


# ==============================================================================
# PUT /subjects/{subject_id}/pattern/{pattern_id}/components/{component_id} tests (Stage 4.2.1b)
# ==============================================================================

class TestUpdatePatternComponent:
    def test_update_only_name_preserves_all_other_fields(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "upd_name")
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern", "is_active": True},
            headers=headers,
        ).json()
        comp = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Initial Name",
                "category": "midsem",
                "max_marks": "50.0",
                "weightage": "30.0",
                "is_active": True,
                "order_index": 2,
            },
            headers=headers,
        ).json()

        res = client.put(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components/{comp['id']}",
            json={"name": "Renamed Exam"},
            headers=headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["name"] == "Renamed Exam"
        assert data["category"] == "midsem"
        assert Decimal(data["max_marks"]) == Decimal("50.00")
        assert Decimal(data["weightage"]) == Decimal("30.00")
        assert data["is_active"] is True
        assert data["order_index"] == 2

    def test_update_only_max_marks_preserves_all_other_fields(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "upd_max_marks")
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern", "is_active": True},
            headers=headers,
        ).json()
        comp = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Quiz",
                "category": "quiz",
                "max_marks": "20.0",
                "weightage": "10.0",
            },
            headers=headers,
        ).json()

        res = client.put(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components/{comp['id']}",
            json={"max_marks": "25.0"},
            headers=headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert Decimal(data["max_marks"]) == Decimal("25.00")
        assert Decimal(data["weightage"]) == Decimal("10.00")
        assert data["name"] == "Quiz"

    def test_merged_state_validation_valid_90_percent_accepted(self, db_session):
        # Spec example: Component A = 40%, Component B = 30%.
        # Update Component B to 50% -> 40% + 50% = 90% (VALID).
        headers, _, _, subj_id = setup_user_and_subject(db_session, "upd_valid_90")
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern", "is_active": True},
            headers=headers,
        ).json()

        # Component A: 40%
        client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Component A",
                "category": "midsem",
                "max_marks": "100.0",
                "weightage": "40.0",
                "is_active": True,
            },
            headers=headers,
        )
        # Component B: 30%
        comp_b = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Component B",
                "category": "endsem",
                "max_marks": "100.0",
                "weightage": "30.0",
                "is_active": True,
            },
            headers=headers,
        ).json()

        # Update Component B to 50%
        res = client.put(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components/{comp_b['id']}",
            json={"weightage": "50.0"},
            headers=headers,
        )
        assert res.status_code == 200
        assert Decimal(res.json()["weightage"]) == Decimal("50.00")

    def test_merged_state_validation_invalid_110_percent_rejected(self, db_session):
        # Spec example: Component A = 40%, Component B = 30%.
        # Update Component B to 70% -> 40% + 70% = 110% (INVALID).
        headers, _, _, subj_id = setup_user_and_subject(db_session, "upd_invalid_110")
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern", "is_active": True},
            headers=headers,
        ).json()

        # Component A: 40%
        client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Component A",
                "category": "midsem",
                "max_marks": "100.0",
                "weightage": "40.0",
                "is_active": True,
            },
            headers=headers,
        )
        # Component B: 30%
        comp_b = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Component B",
                "category": "endsem",
                "max_marks": "100.0",
                "weightage": "30.0",
                "is_active": True,
            },
            headers=headers,
        ).json()

        # Update Component B to 70% -> should be rejected with 422
        res = client.put(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components/{comp_b['id']}",
            json={"weightage": "70.0"},
            headers=headers,
        )
        assert res.status_code == 422
        assert "cannot exceed 100" in res.text

        # Verify failed update leaves database values untouched
        db_session.expire_all()
        reloaded = db_session.get(AssessmentPatternComponent, uuid.UUID(comp_b["id"]))
        assert reloaded.weightage == Decimal("30.00")

    def test_activating_inactive_component_validates_effective_weightage(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "upd_activate_val")
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern", "is_active": True},
            headers=headers,
        ).json()

        # Create inactive component with 0 weightage
        comp = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Draft Component",
                "category": "quiz",
                "max_marks": "10.0",
                "weightage": "0.0",
                "is_active": False,
            },
            headers=headers,
        ).json()

        # Attempt to activate without providing positive weightage -> must fail with 422
        res_fail = client.put(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components/{comp['id']}",
            json={"is_active": True},
            headers=headers,
        )
        assert res_fail.status_code == 422
        assert "greater than 0" in res_fail.text

        # Activate while providing positive weightage -> succeeds
        res_ok = client.put(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components/{comp['id']}",
            json={"is_active": True, "weightage": "15.0"},
            headers=headers,
        )
        assert res_ok.status_code == 200
        assert res_ok.json()["is_active"] is True
        assert Decimal(res_ok.json()["weightage"]) == Decimal("15.00")

    def test_deactivating_component_removes_it_from_active_total(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "upd_deact_free")
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern", "is_active": True},
            headers=headers,
        ).json()

        # Component A: 60%
        comp_a = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Component A",
                "category": "midsem",
                "max_marks": "100.0",
                "weightage": "60.0",
                "is_active": True,
            },
            headers=headers,
        ).json()
        # Component B: 40% (total = 100%)
        comp_b = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Component B",
                "category": "endsem",
                "max_marks": "100.0",
                "weightage": "40.0",
                "is_active": True,
            },
            headers=headers,
        ).json()

        # Deactivate Component A
        res_deact = client.put(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components/{comp_a['id']}",
            json={"is_active": False},
            headers=headers,
        )
        assert res_deact.status_code == 200
        assert res_deact.json()["is_active"] is False

        # Component B can now increase its weightage to 80% without exceeding active 100%
        res_b = client.put(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components/{comp_b['id']}",
            json={"weightage": "80.0"},
            headers=headers,
        )
        assert res_b.status_code == 200
        assert Decimal(res_b.json()["weightage"]) == Decimal("80.00")

    def test_reject_active_zero_weightage_in_update(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "upd_act_zero")
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern", "is_active": True},
            headers=headers,
        ).json()
        comp = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Active Comp",
                "category": "quiz",
                "max_marks": "20.0",
                "weightage": "20.0",
                "is_active": True,
            },
            headers=headers,
        ).json()

        # Attempt to set weightage to 0 while remaining active
        res = client.put(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components/{comp['id']}",
            json={"weightage": "0.0"},
            headers=headers,
        )
        assert res.status_code == 422
        assert "greater than 0" in res.text

    def test_inactive_zero_weightage_accepted_in_update(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "upd_inact_zero")
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern", "is_active": True},
            headers=headers,
        ).json()
        comp = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Active Comp",
                "category": "quiz",
                "max_marks": "20.0",
                "weightage": "20.0",
                "is_active": True,
            },
            headers=headers,
        ).json()

        # Deactivate and set weightage to 0 simultaneously
        res = client.put(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components/{comp['id']}",
            json={"is_active": False, "weightage": "0.0"},
            headers=headers,
        )
        assert res.status_code == 200
        assert res.json()["is_active"] is False
        assert Decimal(res.json()["weightage"]) == Decimal("0.00")

    def test_reject_negative_weightage_in_update(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "upd_neg_wt")
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern", "is_active": True},
            headers=headers,
        ).json()
        comp = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Comp",
                "category": "quiz",
                "max_marks": "20.0",
                "weightage": "20.0",
            },
            headers=headers,
        ).json()

        res = client.put(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components/{comp['id']}",
            json={"weightage": "-5.0"},
            headers=headers,
        )
        assert res.status_code == 422

    def test_reject_invalid_max_marks_in_update(self, db_session):
        headers, _, _, subj_id = setup_user_and_subject(db_session, "upd_bad_marks")
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern", "is_active": True},
            headers=headers,
        ).json()
        comp = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Comp",
                "category": "quiz",
                "max_marks": "20.0",
                "weightage": "20.0",
            },
            headers=headers,
        ).json()

        res = client.put(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components/{comp['id']}",
            json={"max_marks": "0.0"},
            headers=headers,
        )
        assert res.status_code == 422

    def test_reject_cross_user_and_cross_pattern_update(self, db_session):
        headers_a, _, sem_a, subj_a = setup_user_and_subject(db_session, "upd_cross_a")
        headers_b, _, _, _ = setup_user_and_subject(db_session, "upd_cross_b")
        subj_other = client.post(
            f"/semesters/{sem_a}/subjects",
            json={"name": "Other Subj"},
            headers=headers_a,
        ).json()["id"]

        pat_a = client.post(
            f"/subjects/{subj_a}/pattern",
            json={"name": "Pattern A", "is_active": True},
            headers=headers_a,
        ).json()
        comp_a = client.post(
            f"/subjects/{subj_a}/pattern/{pat_a['id']}/components",
            json={
                "name": "Comp A",
                "category": "quiz",
                "max_marks": "20.0",
                "weightage": "20.0",
            },
            headers=headers_a,
        ).json()

        # 1. Cross-user access -> 404
        res_user = client.put(
            f"/subjects/{subj_a}/pattern/{pat_a['id']}/components/{comp_a['id']}",
            json={"name": "Hacked"},
            headers=headers_b,
        )
        assert res_user.status_code == 404

        # 2. Mismatched subject -> 404
        res_subj = client.put(
            f"/subjects/{subj_other}/pattern/{pat_a['id']}/components/{comp_a['id']}",
            json={"name": "Wrong Subj"},
            headers=headers_a,
        )
        assert res_subj.status_code == 404


# ==============================================================================
# DELETE /subjects/{subject_id}/pattern/{pattern_id}/components/{component_id} tests (Stage 4.2.1b)
# ==============================================================================

class TestDeletePatternComponent:
    def test_delete_component_success_and_preserves_assessments(self, db_session):
        headers, _, sem_id, subj_id = setup_user_and_subject(db_session, "del_comp_preserv")

        # 1. Create pattern with 2 components
        pat = client.post(
            f"/subjects/{subj_id}/pattern",
            json={"name": "Pattern", "is_active": True},
            headers=headers,
        ).json()
        comp1 = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "Mid-Sem",
                "category": "midsem",
                "max_marks": "100.0",
                "weightage": "30.0",
            },
            headers=headers,
        ).json()
        comp2 = client.post(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components",
            json={
                "name": "End-Sem",
                "category": "endsem",
                "max_marks": "100.0",
                "weightage": "50.0",
            },
            headers=headers,
        ).json()

        # 2. Create calendar event
        cal_event = AcademicCalendarEvent(
            semester_id=uuid.UUID(sem_id),
            title="Mid-Sem Exam Period",
            event_type="exam",
            start_date=date(2026, 10, 15),
            end_date=date(2026, 10, 20),
            cancels_regular_classes=True,
        )
        db_session.add(cal_event)
        db_session.commit()
        cal_event_id = cal_event.id

        # 3. Create auto-generated assessment linked to comp1 and calendar event
        assessment = Assessment(
            subject_id=uuid.UUID(subj_id),
            name="Mid-Sem Auto Assessment",
            category="midsem",
            max_marks=Decimal("100.00"),
            marks=Decimal("87.50"),
            weightage=Decimal("30.00"),
            status="scored",
            pattern_component_id=uuid.UUID(comp1["id"]),
            calendar_event_id=cal_event_id,
            is_auto_generated=True,
        )
        db_session.add(assessment)
        db_session.commit()
        assessment_id = assessment.id

        # 4. DELETE comp1
        del_res = client.delete(
            f"/subjects/{subj_id}/pattern/{pat['id']}/components/{comp1['id']}",
            headers=headers,
        )
        assert del_res.status_code == 204

        # 5. Verify comp1 is deleted from DB, but comp2 survives
        db_session.expire_all()
        assert db_session.get(AssessmentPatternComponent, uuid.UUID(comp1["id"])) is None
        assert db_session.get(AssessmentPatternComponent, uuid.UUID(comp2["id"])) is not None

        # 6. Verify linked assessment survives, pattern_component_id becomes NULL, and all other fields are intact
        reloaded_ass = db_session.get(Assessment, assessment_id)
        assert reloaded_ass is not None
        assert reloaded_ass.pattern_component_id is None
        assert reloaded_ass.calendar_event_id == cal_event_id
        assert reloaded_ass.is_auto_generated is True
        assert reloaded_ass.name == "Mid-Sem Auto Assessment"
        assert reloaded_ass.category == "midsem"
        assert reloaded_ass.max_marks == Decimal("100.00")
        assert reloaded_ass.marks == Decimal("87.50")
        assert reloaded_ass.weightage == Decimal("30.00")
        assert reloaded_ass.status == "scored"

        # 7. Verify calendar event still exists
        reloaded_event = db_session.get(AcademicCalendarEvent, cal_event_id)
        assert reloaded_event is not None
        assert reloaded_event.id == cal_event_id

    def test_reject_delete_component_cross_user_and_cross_pattern(self, db_session):
        headers_a, _, sem_a, subj_a = setup_user_and_subject(db_session, "del_cross_a")
        headers_b, _, _, _ = setup_user_and_subject(db_session, "del_cross_b")
        subj_other = client.post(
            f"/semesters/{sem_a}/subjects",
            json={"name": "Other Subj"},
            headers=headers_a,
        ).json()["id"]

        pat_a = client.post(
            f"/subjects/{subj_a}/pattern",
            json={"name": "Pattern A", "is_active": True},
            headers=headers_a,
        ).json()
        comp_a = client.post(
            f"/subjects/{subj_a}/pattern/{pat_a['id']}/components",
            json={
                "name": "Comp A",
                "category": "quiz",
                "max_marks": "20.0",
                "weightage": "20.0",
            },
            headers=headers_a,
        ).json()

        # Cross-user deletion -> 404
        res_user = client.delete(
            f"/subjects/{subj_a}/pattern/{pat_a['id']}/components/{comp_a['id']}",
            headers=headers_b,
        )
        assert res_user.status_code == 404

        # Mismatched subject -> 404
        res_subj = client.delete(
            f"/subjects/{subj_other}/pattern/{pat_a['id']}/components/{comp_a['id']}",
            headers=headers_a,
        )
        assert res_subj.status_code == 404

        # Nonexistent component -> 404
        res_none = client.delete(
            f"/subjects/{subj_a}/pattern/{pat_a['id']}/components/{uuid.uuid4()}",
            headers=headers_a,
        )
        assert res_none.status_code == 404


