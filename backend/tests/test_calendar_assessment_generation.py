from datetime import datetime, timezone, timedelta
from decimal import Decimal
from unittest.mock import patch
import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import engine, Base, SessionLocal
from app.models import User, Assessment, AcademicCalendarEvent
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


def create_authenticated_user(db_session, email_prefix: str = "gen_user") -> tuple[dict, User]:
    user = User(email=f"{uuid.uuid4()}_{email_prefix}@example.com", password_hash="hash", name="User")
    db_session.add(user)
    db_session.commit()
    expire = datetime.now(timezone.utc) + timedelta(minutes=60)
    token = jwt.encode({"sub": str(user.id), "exp": expire}, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}, user


def setup_user_sem_subject_pattern(db_session, email_prefix: str = "gen"):
    headers, user = create_authenticated_user(db_session, email_prefix)
    sem = client.post(
        "/semesters",
        json={"name": "Sem 1", "academic_year": "2026-2027"},
        headers=headers,
    ).json()
    subj = client.post(
        f"/semesters/{sem['id']}/subjects",
        json={"name": f"Subj_{uuid.uuid4().hex[:6]}"},
        headers=headers,
    ).json()
    pat = client.post(
        f"/subjects/{subj['id']}/pattern",
        json={
            "name": "Standard Pattern",
            "components": [
                {"name": "Quiz 1", "category": "quiz", "max_marks": 50, "weightage": 20, "is_active": True},
                {"name": "Quiz 2", "category": "quiz", "max_marks": 50, "weightage": 20, "is_active": True},
                {"name": "Midsem", "category": "midsem", "max_marks": 100, "weightage": 30, "is_active": True},
            ],
        },
        headers=headers,
    ).json()
    return headers, user, sem, subj, pat


class TestCalendarAssessmentGeneration:
    # 1. Single subject generates linked Assessment
    def test_create_exam_event_single_subject_generates_assessment(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session)
        comp = pat["components"][0]

        res = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Midterm Examination",
                "event_type": "exam",
                "start_date": "2026-10-15",
                "end_date": "2026-10-15",
                "cancels_regular_classes": True,
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp["id"]}
                ],
            },
            headers=headers,
        )
        assert res.status_code == 201
        ev = res.json()
        assert subj["id"] in ev["subject_ids"]
        assert len(ev["assessment_ids"]) == 1
        ass_id = ev["assessment_ids"][0]

        db_session.expire_all()
        ass = db_session.query(Assessment).filter(Assessment.id == ass_id).first()
        assert ass is not None
        assert str(ass.subject_id) == subj["id"]
        assert str(ass.calendar_event_id) == ev["id"]
        assert str(ass.pattern_component_id) == comp["id"]
        assert ass.is_auto_generated is True
        assert ass.status == "pending"
        assert ass.max_marks == Decimal("50.00")
        assert ass.weightage == Decimal("20.00")
        assert ass.category == "quiz"
        assert ass.name == "Midterm Examination - Quiz 1"
        assert ass.scheduled_at == datetime(2026, 10, 15, 12, 0, 0, tzinfo=timezone.utc)

    # 2. Multiple subjects with different components
    def test_create_exam_event_multiple_subjects_different_components(self, db_session):
        headers, user, sem, subj1, pat1 = setup_user_sem_subject_pattern(db_session, "multi1")
        subj2 = client.post(
            f"/semesters/{sem['id']}/subjects",
            json={"name": "Physics"},
            headers=headers,
        ).json()
        pat2 = client.post(
            f"/subjects/{subj2['id']}/pattern",
            json={
                "name": "Physics Pattern",
                "components": [
                    {"name": "Lab Exam", "category": "practical", "max_marks": 40, "weightage": 25, "is_active": True}
                ],
            },
            headers=headers,
        ).json()

        comp1 = pat1["components"][0]  # Quiz 1
        comp2 = pat2["components"][0]  # Lab Exam

        res = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Semester Assessment Week",
                "event_type": "exam",
                "start_date": "2026-11-01",
                "end_date": "2026-11-05",
                "cancels_regular_classes": True,
                "subject_components": [
                    {"subject_id": subj1["id"], "pattern_component_id": comp1["id"]},
                    {"subject_id": subj2["id"], "pattern_component_id": comp2["id"]},
                ],
            },
            headers=headers,
        )
        assert res.status_code == 201
        ev = res.json()
        assert len(ev["assessment_ids"]) == 2
        assert subj1["id"] in ev["subject_ids"]
        assert subj2["id"] in ev["subject_ids"]

        db_session.expire_all()
        a1 = db_session.query(Assessment).filter(Assessment.pattern_component_id == comp1["id"]).first()
        a2 = db_session.query(Assessment).filter(Assessment.pattern_component_id == comp2["id"]).first()
        assert a1 is not None and str(a1.subject_id) == subj1["id"]
        assert a2 is not None and str(a2.subject_id) == subj2["id"]
        assert a1.name == "Semester Assessment Week - Quiz 1"
        assert a2.name == "Semester Assessment Week - Lab Exam"

    # 3. Deterministic naming collision handling
    def test_deterministic_naming_collision_handling(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session, "collision")
        comp = pat["components"][0]  # "Quiz 1"

        # Pre-create manual assessment with base collision name
        client.post(
            f"/subjects/{subj['id']}/assessments",
            json={
                "name": "Finals - Quiz 1",
                "category": "quiz",
                "max_marks": 50,
                "weightage": 10,
                "status": "pending",
            },
            headers=headers,
        )

        # Create exam event -> collides with base name, should append date
        ev1 = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Finals",
                "event_type": "exam",
                "start_date": "2026-12-10",
                "end_date": "2026-12-10",
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp["id"]}
                ],
            },
            headers=headers,
        ).json()

        db_session.expire_all()
        ass1 = db_session.query(Assessment).filter(Assessment.id == ev1["assessment_ids"][0]).first()
        assert ass1.name == "Finals - Quiz 1 (2026-12-10)"

        # Pre-create manual assessment with date collision name
        client.post(
            f"/subjects/{subj['id']}/assessments",
            json={
                "name": "Finals - Quiz 2 (2026-12-10)",
                "category": "quiz",
                "max_marks": 50,
                "weightage": 10,
                "status": "pending",
            },
            headers=headers,
        )
        # Also pre-create base name for Quiz 2
        client.post(
            f"/subjects/{subj['id']}/assessments",
            json={
                "name": "Finals - Quiz 2",
                "category": "quiz",
                "max_marks": 50,
                "weightage": 10,
                "status": "pending",
            },
            headers=headers,
        )

        comp2 = pat["components"][1]  # "Quiz 2"
        ev2 = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Finals",
                "event_type": "exam",
                "start_date": "2026-12-10",
                "end_date": "2026-12-10",
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp2["id"]}
                ],
            },
            headers=headers,
        ).json()

        db_session.expire_all()
        ass2 = db_session.query(Assessment).filter(Assessment.id == ev2["assessment_ids"][0]).first()
        assert ass2.name == f"Finals - Quiz 2 ({str(ev2['id'])[:8]})"

    # 4. Reject concurrency / duplicate component assignment across events
    def test_reject_component_already_linked_to_another_event(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session, "conflict")
        comp = pat["components"][0]

        res1 = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Exam 1",
                "event_type": "exam",
                "start_date": "2026-10-01",
                "end_date": "2026-10-01",
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp["id"]}
                ],
            },
            headers=headers,
        )
        assert res1.status_code == 201

        # Attempt to link the same component to another event
        res2 = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Exam 2",
                "event_type": "exam",
                "start_date": "2026-10-05",
                "end_date": "2026-10-05",
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp["id"]}
                ],
            },
            headers=headers,
        )
        assert res2.status_code == 409
        assert "already linked" in res2.json()["detail"].lower()

    # 5. Reject generation for inactive pattern
    def test_reject_generation_inactive_pattern(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session, "inact_pat")
        comp = pat["components"][0]

        # Deactivate pattern
        deact_res = client.put(
            f"/subjects/{subj['id']}/pattern/{pat['id']}",
            json={"is_active": False},
            headers=headers,
        )
        assert deact_res.status_code == 200

        res = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Exam Inactive Pattern",
                "event_type": "exam",
                "start_date": "2026-10-01",
                "end_date": "2026-10-01",
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp["id"]}
                ],
            },
            headers=headers,
        )
        assert res.status_code == 422
        assert "inactive" in res.json()["detail"].lower()

    # 6. Reject generation for inactive component
    def test_reject_generation_inactive_component(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session, "inact_comp")
        comp = pat["components"][0]

        # Deactivate component
        client.put(
            f"/subjects/{subj['id']}/pattern/{pat['id']}/components/{comp['id']}",
            json={"is_active": False},
            headers=headers,
        )

        res = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Exam Inactive Component",
                "event_type": "exam",
                "start_date": "2026-10-01",
                "end_date": "2026-10-01",
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp["id"]}
                ],
            },
            headers=headers,
        )
        assert res.status_code == 422
        assert "inactive" in res.json()["detail"].lower()

    # 7. Reject generation when component belongs to a different subject
    def test_reject_component_belongs_to_different_subject(self, db_session):
        headers, user, sem, subj1, pat1 = setup_user_sem_subject_pattern(db_session, "diff_subj1")
        subj2 = client.post(
            f"/semesters/{sem['id']}/subjects",
            json={"name": "Other Subject"},
            headers=headers,
        ).json()
        client.post(
            f"/subjects/{subj2['id']}/pattern",
            json={
                "name": "Subj2 Pattern",
                "components": [
                    {"name": "Subj2 Comp", "category": "quiz", "max_marks": 50, "weightage": 10, "is_active": True}
                ],
            },
            headers=headers,
        )

        comp1 = pat1["components"][0]  # Belongs to subj1

        # Attempt to link comp1 to subj2
        res = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Mismatched Exam",
                "event_type": "exam",
                "start_date": "2026-10-01",
                "end_date": "2026-10-01",
                "subject_components": [
                    {"subject_id": subj2["id"], "pattern_component_id": comp1["id"]}
                ],
            },
            headers=headers,
        )
        assert res.status_code == 422
        assert "does not belong" in res.json()["detail"].lower()

    # 8. Reject generation when component does not exist
    def test_reject_component_does_not_exist(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session, "not_found")
        fake_comp_id = str(uuid.uuid4())

        res = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Exam Nonexistent Comp",
                "event_type": "exam",
                "start_date": "2026-10-01",
                "end_date": "2026-10-01",
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": fake_comp_id}
                ],
            },
            headers=headers,
        )
        assert res.status_code == 404

    # 9. Reject generation when total weightage would exceed 100%
    def test_reject_weightage_cap_exceeded(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session, "weight_cap")
        # Existing manual assessment with 90% weightage
        client.post(
            f"/subjects/{subj['id']}/assessments",
            json={
                "name": "Massive Project",
                "category": "project",
                "max_marks": 100,
                "weightage": 90,
                "status": "pending",
            },
            headers=headers,
        )

        comp = pat["components"][0]  # weightage is 20% (90 + 20 = 110 > 100)

        res = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Exam Exceeding Weightage",
                "event_type": "exam",
                "start_date": "2026-10-01",
                "end_date": "2026-10-01",
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp["id"]}
                ],
            },
            headers=headers,
        )
        assert res.status_code == 422
        assert "exceed 100" in res.json()["detail"].lower()

    # 10. Allow creating exam event with no subjects
    def test_allow_create_exam_with_no_subjects(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session, "no_subj")

        res = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Reading Period Exam",
                "event_type": "exam",
                "start_date": "2026-10-01",
                "end_date": "2026-10-01",
                "subject_components": [],
            },
            headers=headers,
        )
        assert res.status_code == 201
        ev = res.json()
        assert ev["subject_ids"] == []
        assert ev["assessment_ids"] == []

    # 11. Non-exam events with subjects generate no assessments
    def test_non_exam_events_with_subjects_generate_no_assessments(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session, "holiday")

        res = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Diwali Break",
                "event_type": "holiday",
                "start_date": "2026-11-10",
                "end_date": "2026-11-12",
                "cancels_regular_classes": True,
                "subject_ids": [subj["id"]],
            },
            headers=headers,
        )
        assert res.status_code == 201
        ev = res.json()
        assert ev["event_type"] == "holiday"
        assert subj["id"] in ev["subject_ids"]
        assert ev["assessment_ids"] == []

    # 12. Update exam: removing subject detaches assessment safely
    def test_update_exam_removing_subject_detaches_assessment(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session, "detach")
        comp = pat["components"][0]

        ev = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Midterm Exam",
                "event_type": "exam",
                "start_date": "2026-10-15",
                "end_date": "2026-10-15",
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp["id"]}
                ],
            },
            headers=headers,
        ).json()
        ass_id = ev["assessment_ids"][0]

        # Update event removing the subject
        upd_res = client.put(
            f"/semesters/{sem['id']}/calendar/{ev['id']}",
            json={"subject_components": []},
            headers=headers,
        )
        assert upd_res.status_code == 200
        upd = upd_res.json()
        assert upd["subject_ids"] == []
        assert upd["assessment_ids"] == []

        # Verify assessment still exists and has calendar_event_id is None
        db_session.expire_all()
        ass = db_session.query(Assessment).filter(Assessment.id == ass_id).first()
        assert ass is not None
        assert ass.calendar_event_id is None
        assert ass.is_auto_generated is True
        assert str(ass.pattern_component_id) == comp["id"]
        assert ass.max_marks == Decimal("50.00")
        assert ass.weightage == Decimal("20.00")

    # 13. Update exam: changing component when existing assessment is active rejected (409)
    def test_update_exam_changing_component_active_rejected_409(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session, "active_replace")
        comp1 = pat["components"][0]  # Quiz 1
        comp2 = pat["components"][1]  # Quiz 2

        ev = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Exam A",
                "event_type": "exam",
                "start_date": "2026-10-15",
                "end_date": "2026-10-15",
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp1["id"]}
                ],
            },
            headers=headers,
        ).json()

        # Try to switch component to comp2 while comp1 assessment is pending
        res_pending = client.put(
            f"/semesters/{sem['id']}/calendar/{ev['id']}",
            json={
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp2["id"]}
                ]
            },
            headers=headers,
        )
        assert res_pending.status_code == 409
        assert "cannot replace" in res_pending.json()["detail"].lower()

        # Score the assessment
        ass_id = ev["assessment_ids"][0]
        client.put(
            f"/assessments/{ass_id}",
            json={"marks": 45, "status": "scored"},
            headers=headers,
        )

        # Try again while scored
        res_scored = client.put(
            f"/semesters/{sem['id']}/calendar/{ev['id']}",
            json={
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp2["id"]}
                ]
            },
            headers=headers,
        )
        assert res_scored.status_code == 409
        assert "cannot replace" in res_scored.json()["detail"].lower()

    # 14. Update exam: changing component when existing assessment is exempt allowed
    def test_update_exam_changing_component_exempt_allowed(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session, "exempt_replace")
        comp1 = pat["components"][0]  # Quiz 1
        comp2 = pat["components"][1]  # Quiz 2

        ev = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Exam Replace",
                "event_type": "exam",
                "start_date": "2026-10-15",
                "end_date": "2026-10-15",
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp1["id"]}
                ],
            },
            headers=headers,
        ).json()
        ass1_id = ev["assessment_ids"][0]

        # Mark assessment 1 as exempt
        client.put(
            f"/assessments/{ass1_id}",
            json={"status": "exempt"},
            headers=headers,
        )

        # Switch component to comp2
        res = client.put(
            f"/semesters/{sem['id']}/calendar/{ev['id']}",
            json={
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp2["id"]}
                ]
            },
            headers=headers,
        )
        assert res.status_code == 200
        upd = res.json()
        assert len(upd["assessment_ids"]) == 1
        ass2_id = upd["assessment_ids"][0]
        assert ass2_id != ass1_id

        db_session.expire_all()
        old_ass = db_session.query(Assessment).filter(Assessment.id == ass1_id).first()
        new_ass = db_session.query(Assessment).filter(Assessment.id == ass2_id).first()
        assert old_ass.calendar_event_id is None
        assert old_ass.status == "exempt"
        assert str(new_ass.calendar_event_id) == ev["id"]
        assert str(new_ass.pattern_component_id) == comp2["id"]

    # 15. Update exam: re-adding subject with same component re-attaches detached assessment
    def test_update_exam_readding_subject_reattaches_existing_assessment(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session, "reattach")
        comp = pat["components"][0]

        ev = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Reattach Exam",
                "event_type": "exam",
                "start_date": "2026-10-15",
                "end_date": "2026-10-15",
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp["id"]}
                ],
            },
            headers=headers,
        ).json()
        ass_id = ev["assessment_ids"][0]

        # Score assessment
        client.put(
            f"/assessments/{ass_id}",
            json={"marks": 42.5, "status": "scored"},
            headers=headers,
        )

        # Detach by removing subject
        client.put(
            f"/semesters/{sem['id']}/calendar/{ev['id']}",
            json={"subject_components": []},
            headers=headers,
        )

        db_session.expire_all()
        detached_ass = db_session.query(Assessment).filter(Assessment.id == ass_id).first()
        assert detached_ass.calendar_event_id is None

        # Re-add subject with same component
        reatt_res = client.put(
            f"/semesters/{sem['id']}/calendar/{ev['id']}",
            json={
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp["id"]}
                ]
            },
            headers=headers,
        )
        assert reatt_res.status_code == 200
        upd = reatt_res.json()
        assert upd["assessment_ids"] == [ass_id]

        db_session.expire_all()
        # Verify no duplicate created and original assessment re-attached
        total_for_subj = db_session.query(Assessment).filter(Assessment.subject_id == subj["id"]).count()
        assert total_for_subj == 1

        reattached = db_session.query(Assessment).filter(Assessment.id == ass_id).first()
        assert str(reattached.calendar_event_id) == ev["id"]
        assert reattached.marks == Decimal("42.50")
        assert reattached.status == "scored"

    # 16. Update exam dates adjusts scheduled_at for pending assessments only
    def test_update_exam_dates_adjusts_scheduled_at_pending_only(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session, "dates_update")
        comp1 = pat["components"][0]

        ev = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Date Change Exam",
                "event_type": "exam",
                "start_date": "2026-10-15",
                "end_date": "2026-10-15",
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp1["id"]}
                ],
            },
            headers=headers,
        ).json()
        ass_id = ev["assessment_ids"][0]

        # Shift event dates
        client.put(
            f"/semesters/{sem['id']}/calendar/{ev['id']}",
            json={"start_date": "2026-10-25", "end_date": "2026-10-26"},
            headers=headers,
        )

        db_session.expire_all()
        ass = db_session.query(Assessment).filter(Assessment.id == ass_id).first()
        assert ass.scheduled_at == datetime(2026, 10, 25, 12, 0, 0, tzinfo=timezone.utc)

    # 17. Delete exam event detaches all linked assessments safely
    def test_delete_exam_event_detaches_all_linked_assessments(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session, "del_event")
        comp = pat["components"][0]

        ev = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Finals To Delete",
                "event_type": "exam",
                "start_date": "2026-11-20",
                "end_date": "2026-11-20",
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp["id"]}
                ],
            },
            headers=headers,
        ).json()
        ass_id = ev["assessment_ids"][0]

        # Enter score
        client.put(
            f"/assessments/{ass_id}",
            json={"marks": 38, "status": "scored"},
            headers=headers,
        )

        # Delete event
        del_res = client.delete(f"/semesters/{sem['id']}/calendar/{ev['id']}", headers=headers)
        assert del_res.status_code == 204

        # Verify event gone, assessment preserved with calendar_event_id is None
        db_session.expire_all()
        event_in_db = db_session.query(AcademicCalendarEvent).filter(AcademicCalendarEvent.id == ev["id"]).first()
        assert event_in_db is None

        ass = db_session.query(Assessment).filter(Assessment.id == ass_id).first()
        assert ass is not None
        assert ass.calendar_event_id is None
        assert ass.marks == Decimal("38.00")
        assert ass.status == "scored"
        assert ass.is_auto_generated is True

    # 18. POST exam with subjects but omitting explicit component selection fails with 422
    def test_post_exam_with_subjects_without_components_rejected_422(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session, "post_no_comp")

        res = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Exam Without Components",
                "event_type": "exam",
                "start_date": "2026-10-15",
                "end_date": "2026-10-15",
                "cancels_regular_classes": True,
                "subject_ids": [subj["id"]],
            },
            headers=headers,
        )
        assert res.status_code == 422
        assert "explicit assessment pattern component selection" in res.json()["detail"].lower()

    # 19. Regression: Weightage cap during exempt assessment replacement at 100% total weightage
    def test_exempt_assessment_replacement_at_100_percent_weightage(self, db_session):
        headers, user, sem, subj, pat = setup_user_sem_subject_pattern(db_session, "cap_100")
        # Pattern has Quiz 1 (20%), Quiz 2 (20%), Midsem (30%)
        # Add Endsem (30%) so pattern has exactly 100% active weightage
        endsem_res = client.post(
            f"/subjects/{subj['id']}/pattern/{pat['id']}/components",
            json={"name": "Endsem", "category": "endsem", "max_marks": 100, "weightage": 30, "is_active": True},
            headers=headers,
        )
        assert endsem_res.status_code == 201

        # Get components
        comp_quiz1 = pat["components"][0]  # 20%
        comp_midsem = pat["components"][2]  # 30%

        # Create Exam event with Quiz 1 (20%)
        ev = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Quiz 1 Event",
                "event_type": "exam",
                "start_date": "2026-10-10",
                "end_date": "2026-10-10",
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp_quiz1["id"]}
                ],
            },
            headers=headers,
        ).json()
        ass_quiz1_id = ev["assessment_ids"][0]

        # Pre-create manual assessments for Quiz 2 (20%), Midsem (30%), Endsem (30%)
        # Total assessments for subject = 20 + 20 + 30 + 30 = 100%
        client.post(f"/subjects/{subj['id']}/assessments", json={
            "name": "Quiz 2 Manual", "category": "quiz", "max_marks": 50, "weightage": 20, "status": "pending"
        }, headers=headers)
        client.post(f"/subjects/{subj['id']}/assessments", json={
            "name": "Midsem Manual", "category": "midsem", "max_marks": 100, "weightage": 30, "status": "pending"
        }, headers=headers)
        client.post(f"/subjects/{subj['id']}/assessments", json={
            "name": "Endsem Manual", "category": "endsem", "max_marks": 100, "weightage": 30, "status": "pending"
        }, headers=headers)

        db_session.expire_all()
        from sqlalchemy import func
        total_initial = db_session.query(func.sum(Assessment.weightage)).filter(Assessment.subject_id == subj["id"]).scalar()
        assert total_initial == Decimal("100.00")

        # Mark Quiz 1 assessment as exempt
        client.put(f"/assessments/{ass_quiz1_id}", json={"status": "exempt"}, headers=headers)

        # Attempt replacement with Midsem (30%) -> 100 - 20 (old) + 30 (new) = 110% > 100% -> must fail with 422!
        fail_res = client.put(
            f"/semesters/{sem['id']}/calendar/{ev['id']}",
            json={
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp_midsem["id"]}
                ]
            },
            headers=headers,
        )
        assert fail_res.status_code == 422
        assert "exceed 100" in fail_res.json()["detail"].lower()

        # Deactivate Quiz 1 in pattern and add an alternate 20% component "Quiz 1 Retake"
        client.put(f"/subjects/{subj['id']}/pattern/{pat['id']}/components/{comp_quiz1['id']}", json={"is_active": False}, headers=headers)
        retake_res = client.post(
            f"/subjects/{subj['id']}/pattern/{pat['id']}/components",
            json={"name": "Quiz 1 Retake", "category": "quiz", "max_marks": 50, "weightage": 20, "is_active": True},
            headers=headers,
        )
        assert retake_res.status_code == 201
        comp_retake = retake_res.json()

        # Replace Quiz 1 (20% exempt) with Quiz 1 Retake (20%) -> 100 - 20 + 20 = 100% -> must SUCCEED!
        succ_res = client.put(
            f"/semesters/{sem['id']}/calendar/{ev['id']}",
            json={
                "subject_components": [
                    {"subject_id": subj["id"], "pattern_component_id": comp_retake["id"]}
                ]
            },
            headers=headers,
        )
        assert succ_res.status_code == 200
        upd = succ_res.json()
        assert len(upd["assessment_ids"]) == 1
        new_ass_id = upd["assessment_ids"][0]
        assert new_ass_id != ass_quiz1_id

        db_session.expire_all()
        # Verify old assessment remains detached, preserved, and exempt
        old_ass = db_session.query(Assessment).filter(Assessment.id == ass_quiz1_id).first()
        assert old_ass.calendar_event_id is None
        assert old_ass.status == "exempt"
        assert old_ass.weightage == Decimal("20.00")
        assert old_ass.is_auto_generated is True

        # Verify new assessment has correct snapshot and component
        new_ass = db_session.query(Assessment).filter(Assessment.id == new_ass_id).first()
        assert str(new_ass.calendar_event_id) == ev["id"]
        assert str(new_ass.pattern_component_id) == comp_retake["id"]
        assert new_ass.weightage == Decimal("20.00")
        assert new_ass.status == "pending"

        # Verify non-exempt assessments total exactly 100%
        non_exempt_total = db_session.query(func.sum(Assessment.weightage)).filter(
            Assessment.subject_id == subj["id"],
            Assessment.status != "exempt"
        ).scalar()
        assert non_exempt_total == Decimal("100.00")

    # 20. Regression: PUT exam subject semantics (Case A, B, C, D)
    def test_put_exam_subject_semantics_cases(self, db_session):
        headers, user, sem, subj1, pat1 = setup_user_sem_subject_pattern(db_session, "put_sem1")
        subj2 = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Subj2"}, headers=headers).json()
        pat2 = client.post(f"/subjects/{subj2['id']}/pattern", json={
            "name": "P2", "components": [{"name": "C2", "category": "quiz", "max_marks": 50, "weightage": 20, "is_active": True}]
        }, headers=headers).json()
        subj3 = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Subj3"}, headers=headers).json()

        comp1 = pat1["components"][0]
        comp2 = pat2["components"][0]

        # Create exam with Subj1 and Subj2
        ev = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Semester Exam",
                "event_type": "exam",
                "start_date": "2026-10-20",
                "end_date": "2026-10-20",
                "subject_components": [
                    {"subject_id": subj1["id"], "pattern_component_id": comp1["id"]},
                    {"subject_id": subj2["id"], "pattern_component_id": comp2["id"]},
                ],
            },
            headers=headers,
        ).json()
        assert len(ev["assessment_ids"]) == 2

        # Case A2: PUT with newly added subject in subject_ids without subject_components fails with 422
        res_a2 = client.put(
            f"/semesters/{sem['id']}/calendar/{ev['id']}",
            json={"subject_ids": [subj1["id"], subj3["id"]]},
            headers=headers,
        )
        assert res_a2.status_code == 422
        assert "newly added exam subjects require an explicit assessment pattern component selection" in res_a2.json()["detail"].lower()

        # Case A1: PUT with subject_ids omitting subject_components retains subj1 and removes subj2
        res_a1 = client.put(
            f"/semesters/{sem['id']}/calendar/{ev['id']}",
            json={"subject_ids": [subj1["id"]]},
            headers=headers,
        )
        assert res_a1.status_code == 200
        upd_a1 = res_a1.json()
        assert upd_a1["subject_ids"] == [subj1["id"]]

        db_session.expire_all()
        ass1_after = db_session.query(Assessment).filter(Assessment.pattern_component_id == comp1["id"]).first()
        ass2_after = db_session.query(Assessment).filter(Assessment.pattern_component_id == comp2["id"]).first()
        # Subj1 assessment remains linked
        assert str(ass1_after.calendar_event_id) == ev["id"]
        # Subj2 assessment is detached, not deleted!
        assert ass2_after.calendar_event_id is None
        assert ass2_after.is_auto_generated is True

        # Case C: PUT with subject_components: [] clears all subjects and detaches all assessments
        res_c = client.put(
            f"/semesters/{sem['id']}/calendar/{ev['id']}",
            json={"subject_components": []},
            headers=headers,
        )
        assert res_c.status_code == 200
        upd_c = res_c.json()
        assert upd_c["subject_ids"] == []
        assert upd_c["assessment_ids"] == []

        db_session.expire_all()
        ass1_c = db_session.query(Assessment).filter(Assessment.pattern_component_id == comp1["id"]).first()
        assert ass1_c.calendar_event_id is None

        # Case D: Non-exam event PUT with subject_ids updates subject_ids without requiring components
        hol = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={"title": "Break", "event_type": "holiday", "start_date": "2026-11-01", "end_date": "2026-11-01", "subject_ids": [subj1["id"]]},
            headers=headers,
        ).json()
        hol_upd = client.put(
            f"/semesters/{sem['id']}/calendar/{hol['id']}",
            json={"subject_ids": [subj1["id"], subj2["id"]]},
            headers=headers,
        )
        assert hol_upd.status_code == 200
        assert set(hol_upd.json()["subject_ids"]) == {subj1["id"], subj2["id"]}

    # 21. Atomicity: Multi-subject exam rollback on partial failure
    def test_atomicity_multi_subject_rollback_on_partial_failure(self, db_session):
        headers, user, sem, subj1, pat1 = setup_user_sem_subject_pattern(db_session, "atom_fail")
        subj2 = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Subj2 Atom"}, headers=headers).json()
        pat2 = client.post(f"/subjects/{subj2['id']}/pattern", json={
            "name": "P2 Inactive",
            "components": [{"name": "C2 Inactive", "category": "quiz", "max_marks": 50, "weightage": 20, "is_active": False}]
        }, headers=headers).json()

        comp1 = pat1["components"][0]  # Valid active component
        comp2 = pat2["components"][0]  # Inactive component (invalid)

        # Baseline counts
        db_session.expire_all()
        events_before = db_session.query(AcademicCalendarEvent).filter(AcademicCalendarEvent.semester_id == sem["id"]).count()
        ass_subj1_before = db_session.query(Assessment).filter(Assessment.subject_id == subj1["id"]).count()

        # Submit multi-subject exam where subj1 is valid and subj2 is invalid
        res = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Atomic Fail Exam",
                "event_type": "exam",
                "start_date": "2026-10-30",
                "end_date": "2026-10-30",
                "subject_components": [
                    {"subject_id": subj1["id"], "pattern_component_id": comp1["id"]},
                    {"subject_id": subj2["id"], "pattern_component_id": comp2["id"]},
                ],
            },
            headers=headers,
        )
        assert res.status_code == 422
        assert "inactive" in res.json()["detail"].lower()

        # Verify rollback: no event created, no assessment generated for Subject 1
        db_session.expire_all()
        events_after = db_session.query(AcademicCalendarEvent).filter(AcademicCalendarEvent.semester_id == sem["id"]).count()
        assert events_after == events_before

        failed_event = db_session.query(AcademicCalendarEvent).filter(AcademicCalendarEvent.title == "Atomic Fail Exam").first()
        assert failed_event is None

        ass_subj1_after = db_session.query(Assessment).filter(Assessment.subject_id == subj1["id"]).count()
        assert ass_subj1_after == ass_subj1_before

    # 22. Exam date update shifts scheduled_at for ALL linked assessments (pending and scored) while preserving detached
    def test_update_exam_date_shifts_both_pending_and_scored_linked_assessments_preserves_detached(self, db_session):
        headers, user, sem, subj1, pat1 = setup_user_sem_subject_pattern(db_session, "dt_shift1")
        subj2 = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Subj2 DateShift"}, headers=headers).json()
        pat2 = client.post(f"/subjects/{subj2['id']}/pattern", json={
            "name": "P2 DateShift",
            "components": [{"name": "C2 DateShift", "category": "quiz", "max_marks": 50, "weightage": 20, "is_active": True}]
        }, headers=headers).json()
        subj3 = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Subj3 Detached"}, headers=headers).json()
        pat3 = client.post(f"/subjects/{subj3['id']}/pattern", json={
            "name": "P3 Detached",
            "components": [{"name": "C3 Detached", "category": "quiz", "max_marks": 40, "weightage": 15, "is_active": True}]
        }, headers=headers).json()

        comp1 = pat1["components"][0]
        comp2 = pat2["components"][0]
        comp3 = pat3["components"][0]

        # Create exam event on 2026-10-15 with all 3 subjects
        ev = client.post(
            f"/semesters/{sem['id']}/calendar",
            json={
                "title": "Date Shift Exam",
                "event_type": "exam",
                "start_date": "2026-10-15",
                "end_date": "2026-10-15",
                "subject_components": [
                    {"subject_id": subj1["id"], "pattern_component_id": comp1["id"]},
                    {"subject_id": subj2["id"], "pattern_component_id": comp2["id"]},
                    {"subject_id": subj3["id"], "pattern_component_id": comp3["id"]},
                ],
            },
            headers=headers,
        ).json()

        db_session.expire_all()
        ass1 = db_session.query(Assessment).filter(Assessment.pattern_component_id == comp1["id"]).first()
        ass2 = db_session.query(Assessment).filter(Assessment.pattern_component_id == comp2["id"]).first()
        ass3 = db_session.query(Assessment).filter(Assessment.pattern_component_id == comp3["id"]).first()

        # Score assessment 2
        client.put(f"/assessments/{ass2.id}", json={"marks": 42.5, "status": "scored"}, headers=headers)

        # Detach assessment 3 by removing subject 3
        client.put(
            f"/semesters/{sem['id']}/calendar/{ev['id']}",
            json={
                "subject_components": [
                    {"subject_id": subj1["id"], "pattern_component_id": comp1["id"]},
                    {"subject_id": subj2["id"], "pattern_component_id": comp2["id"]},
                ]
            },
            headers=headers,
        )

        db_session.expire_all()
        ass3_detached = db_session.query(Assessment).filter(Assessment.id == ass3.id).first()
        assert ass3_detached.calendar_event_id is None
        orig_scheduled = datetime(2026, 10, 15, 12, 0, 0, tzinfo=timezone.utc)
        assert ass3_detached.scheduled_at == orig_scheduled

        # Now change the exam event date from 2026-10-15 to 2026-10-25
        res = client.put(
            f"/semesters/{sem['id']}/calendar/{ev['id']}",
            json={"start_date": "2026-10-25", "end_date": "2026-10-25"},
            headers=headers,
        )
        assert res.status_code == 200

        db_session.expire_all()
        new_scheduled = datetime(2026, 10, 25, 12, 0, 0, tzinfo=timezone.utc)

        ass1_reloaded = db_session.query(Assessment).filter(Assessment.id == ass1.id).first()
        ass2_reloaded = db_session.query(Assessment).filter(Assessment.id == ass2.id).first()
        ass3_reloaded = db_session.query(Assessment).filter(Assessment.id == ass3.id).first()

        # Both linked assessments (pending and scored) receive the new date
        assert ass1_reloaded.scheduled_at == new_scheduled
        assert ass1_reloaded.status == "pending"
        assert str(ass1_reloaded.calendar_event_id) == ev["id"]

        assert ass2_reloaded.scheduled_at == new_scheduled
        assert ass2_reloaded.status == "scored"
        assert ass2_reloaded.marks == Decimal("42.50")
        assert ass2_reloaded.max_marks == Decimal("50.00")
        assert ass2_reloaded.weightage == Decimal("20.00")
        assert str(ass2_reloaded.calendar_event_id) == ev["id"]
        assert str(ass2_reloaded.pattern_component_id) == comp2["id"]
        assert ass2_reloaded.is_auto_generated is True

        # Detached assessment retains its original date
        assert ass3_reloaded.calendar_event_id is None
        assert ass3_reloaded.scheduled_at == orig_scheduled
        assert ass3_reloaded.max_marks == Decimal("40.00")
        assert ass3_reloaded.weightage == Decimal("15.00")

    # 23. Atomicity: Rollback after partial generation has begun (assessment 1 flushed to DB)
    def test_atomicity_rollback_after_first_assessment_flushed(self, db_session):
        headers, user, sem, subj1, pat1 = setup_user_sem_subject_pattern(db_session, "flush_fail1")
        subj2 = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Subj2 FlushFail"}, headers=headers).json()
        pat2 = client.post(f"/subjects/{subj2['id']}/pattern", json={
            "name": "P2 FlushFail",
            "components": [{"name": "C2 FlushFail", "category": "quiz", "max_marks": 50, "weightage": 20, "is_active": True}]
        }, headers=headers).json()

        comp1 = pat1["components"][0]
        comp2 = pat2["components"][0]

        from app.routers import timetable as tt_module
        original_resolve = tt_module.resolve_assessment_name

        call_count = 0
        def mock_resolve_assessment_name(db, subject_id, title, comp_name, start_date, event_id, current_assessment_id=None):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return original_resolve(db, subject_id, title, comp_name, start_date, event_id, current_assessment_id)
            else:
                # Flush the session explicitly while in transaction: event and assessment 1 are flushed to PostgreSQL!
                db.flush()
                # Verify assessment 1 and event actually exist in the database transaction at this moment
                flushed_ass1 = db.query(Assessment).filter(Assessment.subject_id == subj1["id"]).first()
                assert flushed_ass1 is not None
                flushed_ev = db.query(AcademicCalendarEvent).filter(AcademicCalendarEvent.title == "Flushed Rollback Exam").first()
                assert flushed_ev is not None

                # Trigger deterministic controlled failure during processing of second assessment
                raise RuntimeError("Controlled failure during second assessment generation after first was flushed")

        with patch("app.routers.timetable.resolve_assessment_name", side_effect=mock_resolve_assessment_name):
            with pytest.raises(RuntimeError, match="Controlled failure during second assessment"):
                client.post(
                    f"/semesters/{sem['id']}/calendar",
                    json={
                        "title": "Flushed Rollback Exam",
                        "event_type": "exam",
                        "start_date": "2026-11-15",
                        "end_date": "2026-11-15",
                        "subject_components": [
                            {"subject_id": subj1["id"], "pattern_component_id": comp1["id"]},
                            {"subject_id": subj2["id"], "pattern_component_id": comp2["id"]},
                        ],
                    },
                    headers=headers,
                )

        # Verify transaction rollback: no event, no event-subject association, and no generated assessment remain!
        db_session.expire_all()
        event_after = db_session.query(AcademicCalendarEvent).filter(AcademicCalendarEvent.title == "Flushed Rollback Exam").first()
        assert event_after is None

        ass1_after = db_session.query(Assessment).filter(Assessment.subject_id == subj1["id"]).first()
        assert ass1_after is None

        ass2_after = db_session.query(Assessment).filter(Assessment.subject_id == subj2["id"]).first()
        assert ass2_after is None
