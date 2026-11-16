from datetime import date, time, datetime, timezone, timedelta
from decimal import Decimal
import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import engine, Base, SessionLocal
from app.models import User, Semester, Subject, Assessment, Attendance, TimetableSlot, AcademicCalendarEvent, TimetableOverride, LectureAttendance
from app.config import settings
from app.routers.timetable import get_user_today
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


class TestTimetableSlotEndpoints:
    def test_unauthenticated_request_rejected(self):
        fake_id = uuid.uuid4()
        res = client.get(f"/semesters/{fake_id}/timetable")
        assert res.status_code == 401 or res.status_code == 403

    def test_create_and_list_timetable_slot_success(self, db_session):
        headers, user = create_authenticated_user(db_session)
        sem = client.post("/semesters", json={"name": "Fall 2026", "academic_year": "2026", "start_date": "2026-09-01", "end_date": "2026-12-20"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Data Structures"}, headers=headers).json()

        # Create slot: Monday 09:00 - 10:30
        res = client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj["id"],
            "day_of_week": 0,
            "start_time": "09:00:00",
            "end_time": "10:30:00",
            "effective_from": "2026-09-01",
            "effective_to": "2026-12-20",
        }, headers=headers)
        assert res.status_code == 201, res.text
        slot = res.json()
        assert slot["day_of_week"] == 0
        assert slot["start_time"] == "09:00:00"
        assert slot["end_time"] == "10:30:00"

        # List slots
        list_res = client.get(f"/semesters/{sem['id']}/timetable", headers=headers)
        assert list_res.status_code == 200
        slots = list_res.json()
        assert len(slots) == 1
        assert slots[0]["id"] == slot["id"]

    def test_cross_user_access_prevented(self, db_session):
        headers_a, user_a = create_authenticated_user(db_session, "user_a")
        headers_b, user_b = create_authenticated_user(db_session, "user_b")

        sem_a = client.post("/semesters", json={"name": "User A Sem", "academic_year": "2026"}, headers=headers_a).json()
        subj_a = client.post(f"/semesters/{sem_a['id']}/subjects", json={"name": "Subject A"}, headers=headers_a).json()

        # User B tries to view User A's timetable
        res_view = client.get(f"/semesters/{sem_a['id']}/timetable", headers=headers_b)
        assert res_view.status_code == 404

        # User B tries to add a slot to User A's semester
        res_post = client.post(f"/semesters/{sem_a['id']}/timetable", json={
            "subject_id": subj_a["id"],
            "day_of_week": 1,
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "effective_from": "2026-09-01",
        }, headers=headers_b)
        assert res_post.status_code == 404

    def test_cross_semester_subject_reference_prevented(self, db_session):
        headers, user = create_authenticated_user(db_session)
        sem1 = client.post("/semesters", json={"name": "Sem 1", "academic_year": "2026"}, headers=headers).json()
        sem2 = client.post("/semesters", json={"name": "Sem 2", "academic_year": "2027"}, headers=headers).json()
        subj2 = client.post(f"/semesters/{sem2['id']}/subjects", json={"name": "Subject in Sem 2"}, headers=headers).json()

        # Try adding slot in Sem 1 referencing Subject from Sem 2
        res = client.post(f"/semesters/{sem1['id']}/timetable", json={
            "subject_id": subj2["id"],
            "day_of_week": 2,
            "start_time": "11:00:00",
            "end_time": "12:00:00",
            "effective_from": "2026-09-01",
        }, headers=headers)
        assert res.status_code == 404
        assert "not found in this semester" in res.json()["detail"].lower()

    def test_conflicting_slot_rejected(self, db_session):
        headers, user = create_authenticated_user(db_session)
        sem = client.post("/semesters", json={"name": "Conflict Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Math"}, headers=headers).json()

        # Create slot 1: Mon 09:00 - 10:30
        client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj["id"],
            "day_of_week": 0,
            "start_time": "09:00:00",
            "end_time": "10:30:00",
            "effective_from": "2026-09-01",
        }, headers=headers)

        # Attempt overlapping slot: Mon 10:00 - 11:00
        res = client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj["id"],
            "day_of_week": 0,
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "effective_from": "2026-09-01",
        }, headers=headers)
        assert res.status_code == 400
        assert "conflicting timetable slot" in res.json()["detail"].lower()

    def test_update_and_delete_timetable_slot(self, db_session):
        headers, user = create_authenticated_user(db_session)
        sem = client.post("/semesters", json={"name": "Update Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Algorithms"}, headers=headers).json()

        slot = client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj["id"],
            "day_of_week": 3,
            "start_time": "14:00:00",
            "end_time": "15:30:00",
            "effective_from": "2026-09-01",
        }, headers=headers).json()

        # Update end time
        upd_res = client.put(f"/semesters/{sem['id']}/timetable/{slot['id']}", json={
            "end_time": "16:00:00"
        }, headers=headers)
        assert upd_res.status_code == 200
        assert upd_res.json()["end_time"] == "16:00:00"

        # Delete slot
        del_res = client.delete(f"/semesters/{sem['id']}/timetable/{slot['id']}", headers=headers)
        assert del_res.status_code == 204

        # Verify list is empty
        list_res = client.get(f"/semesters/{sem['id']}/timetable", headers=headers)
        assert len(list_res.json()) == 0


class TestAcademicCalendarEndpoints:
    def test_create_and_list_calendar_events_with_exam_linking(self, db_session):
        headers, user = create_authenticated_user(db_session)
        sem = client.post("/semesters", json={"name": "Cal Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "History"}, headers=headers).json()

        # Create assessment scheduled on 2026-10-15
        ass = client.post(f"/subjects/{subj['id']}/assessments", json={
            "name": "Midterm Exam",
            "category": "midsem",
            "max_marks": 100,
            "weightage": 30,
            "scheduled_at": "2026-10-15T09:00:00Z"
        }, headers=headers).json()

        # Creating exam with subjects but omitting explicit component selection fails with 422
        bad_res = client.post(f"/semesters/{sem['id']}/calendar", json={
            "title": "Midterm Exam Period",
            "event_type": "exam",
            "start_date": "2026-10-15",
            "end_date": "2026-10-15",
            "cancels_regular_classes": True,
            "subject_ids": [subj["id"]],
        }, headers=headers)
        assert bad_res.status_code == 422

        # Create assessment pattern and component for explicit selection
        pat = client.post(f"/subjects/{subj['id']}/pattern", json={
            "name": "History Pattern",
            "components": [
                {"name": "Midterm Component", "category": "midsem", "max_marks": 100, "weightage": 30, "is_active": True}
            ]
        }, headers=headers).json()
        comp = pat["components"][0]

        # Create Exam event on 2026-10-15 with explicit component selection
        res = client.post(f"/semesters/{sem['id']}/calendar", json={
            "title": "Midterm Exam Period",
            "event_type": "exam",
            "start_date": "2026-10-15",
            "end_date": "2026-10-15",
            "cancels_regular_classes": True,
            "subject_components": [
                {"subject_id": subj["id"], "pattern_component_id": comp["id"]}
            ],
        }, headers=headers)
        assert res.status_code == 201
        ev = res.json()
        assert ev["title"] == "Midterm Exam Period"
        assert ev["event_type"] == "exam"
        assert subj["id"] in ev["subject_ids"]
        assert ass["id"] in ev["assessment_ids"]

        # List events
        events = client.get(f"/semesters/{sem['id']}/calendar", headers=headers).json()
        assert len(events) == 1
        assert events[0]["id"] == ev["id"]

    def test_holiday_event_crud(self, db_session):
        headers, user = create_authenticated_user(db_session)
        sem = client.post("/semesters", json={"name": "Holiday Sem", "academic_year": "2026"}, headers=headers).json()

        ev = client.post(f"/semesters/{sem['id']}/calendar", json={
            "title": "National Holiday",
            "event_type": "holiday",
            "start_date": "2026-10-02",
            "end_date": "2026-10-02",
            "cancels_regular_classes": True,
        }, headers=headers).json()

        # Update event title
        upd = client.put(f"/semesters/{sem['id']}/calendar/{ev['id']}", json={
            "title": "Gandhi Jayanti"
        }, headers=headers).json()
        assert upd["title"] == "Gandhi Jayanti"

        # Delete event
        del_res = client.delete(f"/semesters/{sem['id']}/calendar/{ev['id']}", headers=headers)
        assert del_res.status_code == 204


class TestTimetableOverridesEndpoints:
    def test_create_and_delete_overrides(self, db_session):
        headers, user = create_authenticated_user(db_session)
        sem = client.post("/semesters", json={"name": "Override Sem", "academic_year": "2026", "start_date": "2026-09-01", "end_date": "2026-12-20"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Bio"}, headers=headers).json()

        slot = client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj["id"],
            "day_of_week": 1,
            "start_time": "10:00:00",
            "end_time": "11:30:00",
            "effective_from": "2026-09-01",
        }, headers=headers).json()

        # 1. Cancelled lecture override
        canc_res = client.post(f"/semesters/{sem['id']}/overrides", json={
            "subject_id": subj["id"],
            "override_type": "cancelled",
            "timetable_slot_id": slot["id"],
            "original_date": "2026-09-08",
            "target_date": "2026-09-08",
            "start_time": "10:00:00",
            "end_time": "11:30:00",
            "note": "Conference attendance",
        }, headers=headers)
        assert canc_res.status_code == 201

        # Duplicate cancellation rejected
        dup_canc = client.post(f"/semesters/{sem['id']}/overrides", json={
            "subject_id": subj["id"],
            "override_type": "cancelled",
            "target_date": "2026-09-08",
            "start_time": "10:00:00",
            "end_time": "11:30:00",
            "original_date": "2026-09-08",
        }, headers=headers)
        assert dup_canc.status_code == 400

        # 2. Rescheduled lecture override
        resched_res = client.post(f"/semesters/{sem['id']}/overrides", json={
            "subject_id": subj["id"],
            "override_type": "rescheduled",
            "timetable_slot_id": slot["id"],
            "original_date": "2026-09-15",
            "target_date": "2026-09-17",
            "start_time": "14:00:00",
            "end_time": "15:30:00",
            "note": "Makeup on Thursday",
        }, headers=headers)
        assert resched_res.status_code == 201

        # 3. Extra lecture override
        extra_res = client.post(f"/semesters/{sem['id']}/overrides", json={
            "subject_id": subj["id"],
            "override_type": "extra",
            "target_date": "2026-09-18",
            "start_time": "09:00:00",
            "end_time": "10:00:00",
            "note": "Review session",
        }, headers=headers)
        assert extra_res.status_code == 201
        extra_id = extra_res.json()["id"]

        # List overrides
        overrides = client.get(f"/semesters/{sem['id']}/overrides", headers=headers).json()
        assert len(overrides) == 3

        # Delete extra override
        del_res = client.delete(f"/semesters/{sem['id']}/overrides/{extra_id}", headers=headers)
        assert del_res.status_code == 204
        assert len(client.get(f"/semesters/{sem['id']}/overrides", headers=headers).json()) == 2


class TestLectureScheduleAndAttendanceEndpoints:
    def test_scheduled_lectures_resolution(self, db_session):
        headers, user = create_authenticated_user(db_session)
        sem = client.post("/semesters", json={"name": "Sched Sem", "academic_year": "2026", "start_date": "2026-09-07", "end_date": "2026-09-20"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Databases", "code": "CS301"}, headers=headers).json()

        # Monday slot 09:00 - 10:00
        slot = client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj["id"],
            "day_of_week": 0,
            "start_time": "09:00:00",
            "end_time": "10:00:00",
            "effective_from": "2026-09-07",
        }, headers=headers).json()

        # Cancelled override on Sept 14
        client.post(f"/semesters/{sem['id']}/overrides", json={
            "subject_id": subj["id"],
            "override_type": "cancelled",
            "timetable_slot_id": slot["id"],
            "original_date": "2026-09-14",
            "target_date": "2026-09-14",
            "start_time": "09:00:00",
            "end_time": "10:00:00",
            "note": "Instructor conference",
        }, headers=headers)

        # Resolve schedule from Sept 7 to Sept 20
        res = client.get(f"/semesters/{sem['id']}/lectures?from_date=2026-09-07&to_date=2026-09-20", headers=headers)
        assert res.status_code == 200
        lectures = res.json()
        assert len(lectures) == 2

        # Sept 7 is normal
        assert lectures[0]["lecture_date"] == "2026-09-07"
        assert lectures[0]["is_cancelled"] is False
        assert lectures[0]["subject_name"] == "Databases"
        assert lectures[0]["subject_code"] == "CS301"

        # Sept 14 is cancelled
        assert lectures[1]["lecture_date"] == "2026-09-14"
        assert lectures[1]["is_cancelled"] is True
        assert lectures[1]["cancellation_reason"] == "Instructor conference"

    def test_record_attendance_future_date_rejected(self, db_session):
        headers, user = create_authenticated_user(db_session)
        sem = client.post("/semesters", json={"name": "Att Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Physics"}, headers=headers).json()

        today_user = get_user_today(user)
        tomorrow = (today_user + timedelta(days=1)).isoformat()
        res = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": tomorrow,
            "start_time": "09:00:00",
            "end_time": "10:00:00",
            "status": "attended",
        }, headers=headers)
        assert res.status_code == 400
        assert "future dates" in res.json()["detail"].lower()

    def test_record_attendance_with_client_timezone_headers(self, db_session):
        headers, user = create_authenticated_user(db_session)
        sem = client.post("/semesters", json={"name": "Tz Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Chemistry"}, headers=headers).json()

        today_obj = get_user_today(user)
        today_str = today_obj.isoformat()

        # Create scheduled slot for today
        client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj["id"],
            "day_of_week": today_obj.weekday(),
            "start_time": "09:00:00",
            "end_time": "10:00:00",
            "effective_from": (today_obj - timedelta(days=30)).isoformat(),
        }, headers=headers)

        res = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": today_str,
            "start_time": "09:00:00",
            "end_time": "10:00:00",
            "status": "attended",
        }, headers={**headers, "X-Client-Date": today_str, "X-Client-Timezone": "UTC"})
        assert res.status_code == 200

        # Attempt spoofing X-Client-Date in the future to record future attendance
        spoofed_future = (today_obj + timedelta(days=1)).isoformat()
        res_spoof = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": spoofed_future,
            "start_time": "09:00:00",
            "end_time": "10:00:00",
            "status": "attended",
        }, headers={**headers, "X-Client-Date": spoofed_future})
        assert res_spoof.status_code == 400
        assert "future dates" in res_spoof.json()["detail"].lower()

    def test_record_and_correct_attendance_idempotent_upsert(self, db_session):
        headers, user = create_authenticated_user(db_session)
        sem = client.post("/semesters", json={"name": "Att Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Physics"}, headers=headers).json()

        today_obj = get_user_today(user)
        today_str = today_obj.isoformat()

        client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj["id"],
            "day_of_week": today_obj.weekday(),
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "effective_from": (today_obj - timedelta(days=30)).isoformat(),
        }, headers=headers)

        # Mark as missed for today
        res1 = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": today_str,
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "status": "missed",
        }, headers=headers)
        assert res1.status_code == 200
        record1 = res1.json()
        assert record1["status"] == "missed"

        # Correct to attended (same subject, date, and start_time)
        res2 = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": today_str,
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "status": "attended",
        }, headers=headers)
        assert res2.status_code == 200
        record2 = res2.json()
        assert record2["id"] == record1["id"]
        assert record2["status"] == "attended"

        # Verify only 1 record exists in list
        list_res = client.get(f"/semesters/{sem['id']}/lectures/attendance", headers=headers)
        assert len(list_res.json()) == 1

    def test_subject_attendance_summary_endpoint(self, db_session):
        headers, user = create_authenticated_user(db_session)
        sem = client.post("/semesters", json={"name": "Summary Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={
            "name": "Calculus",
            "attendance_target_percentage": 75
        }, headers=headers).json()

        # Record 3 attended, 1 missed, 1 cancelled in past dates
        d1 = (date.today() - timedelta(days=5)).isoformat()
        d2 = (date.today() - timedelta(days=4)).isoformat()
        d3 = (date.today() - timedelta(days=3)).isoformat()
        d4 = (date.today() - timedelta(days=2)).isoformat()
        d5 = (date.today() - timedelta(days=1)).isoformat()

        for d_str in (d1, d2, d3, d4, d5):
            d_obj = date.fromisoformat(d_str)
            client.post(f"/semesters/{sem['id']}/timetable", json={
                "subject_id": subj["id"],
                "day_of_week": d_obj.weekday(),
                "start_time": "09:00:00",
                "end_time": "10:00:00",
                "effective_from": (date.today() - timedelta(days=30)).isoformat(),
            }, headers=headers)

        client.post(f"/semesters/{sem['id']}/lectures/attendance", json={"subject_id": subj["id"], "lecture_date": d1, "start_time": "09:00:00", "end_time": "10:00:00", "status": "attended"}, headers=headers)
        client.post(f"/semesters/{sem['id']}/lectures/attendance", json={"subject_id": subj["id"], "lecture_date": d2, "start_time": "09:00:00", "end_time": "10:00:00", "status": "attended"}, headers=headers)
        client.post(f"/semesters/{sem['id']}/lectures/attendance", json={"subject_id": subj["id"], "lecture_date": d3, "start_time": "09:00:00", "end_time": "10:00:00", "status": "attended"}, headers=headers)
        client.post(f"/semesters/{sem['id']}/lectures/attendance", json={"subject_id": subj["id"], "lecture_date": d4, "start_time": "09:00:00", "end_time": "10:00:00", "status": "missed"}, headers=headers)
        client.post(f"/semesters/{sem['id']}/lectures/attendance", json={"subject_id": subj["id"], "lecture_date": d5, "start_time": "09:00:00", "end_time": "10:00:00", "status": "class_cancelled"}, headers=headers)

        res = client.get(f"/subjects/{subj['id']}/attendance-summary", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["attended"] == 3
        assert data["missed"] == 1
        assert data["held"] == 4
        assert data["cancelled"] == 1
        assert float(data["percentage"]) == 75.0
        assert data["is_at_or_above_target"] is True
        assert data["classes_to_attend"] == 0
        assert data["classes_can_miss"] == 0

    def test_dashboard_uses_lecture_attendances_and_falls_back_to_legacy(self, db_session):
        headers, user = create_authenticated_user(db_session)
        sem = client.post("/semesters", json={"name": "Dash Sem", "academic_year": "2026"}, headers=headers).json()
        client.patch(f"/semesters/{sem['id']}/activate", headers=headers)

        # Subject 1 uses new lecture attendances
        subj1 = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Subj 1"}, headers=headers).json()
        past_obj = date.today() - timedelta(days=2)
        past_date = past_obj.isoformat()

        client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj1["id"],
            "day_of_week": past_obj.weekday(),
            "start_time": "08:00:00",
            "end_time": "09:00:00",
            "effective_from": (date.today() - timedelta(days=30)).isoformat(),
        }, headers=headers)

        client.post(f"/semesters/{sem['id']}/lectures/attendance", json={"subject_id": subj1["id"], "lecture_date": past_date, "start_time": "08:00:00", "end_time": "09:00:00", "status": "attended"}, headers=headers)

        # Subject 2 uses legacy attendance record
        subj2 = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Subj 2"}, headers=headers).json()
        client.post(f"/subjects/{subj2['id']}/attendance", json={"classes_attended": 8, "classes_held": 10, "recorded_on": past_date}, headers=headers)

        dash = client.get("/dashboard", headers=headers).json()
        summaries = {s["subject_name"]: s for s in dash["subject_summaries"]}

        # Subj 1: 1 attended / 1 held = 100%
        assert float(summaries["Subj 1"]["attendance_percentage"]) == 100.0

        # Subj 2: 8 attended / 10 held = 80% (legacy fallback)
        assert float(summaries["Subj 2"]["attendance_percentage"]) == 80.0


class TestPhase2IntegrityAndSecurityFixes:
    def test_client_spoofed_tomorrow_date_rejected(self, db_session):
        headers, user = create_authenticated_user(db_session, "tz_spoof")
        sem = client.post("/semesters", json={"name": "Spoof Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Math"}, headers=headers).json()

        today_user = get_user_today(user)
        tomorrow_obj = today_user + timedelta(days=1)
        tomorrow_str = tomorrow_obj.isoformat()

        # Create slot for tomorrow's weekday
        client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj["id"],
            "day_of_week": tomorrow_obj.weekday(),
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "effective_from": (today_user - timedelta(days=10)).isoformat(),
        }, headers=headers)

        # Attempt to mark attendance for tomorrow sending spoofed X-Client-Date
        res = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": tomorrow_str,
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "status": "attended",
        }, headers={**headers, "X-Client-Date": tomorrow_str})
        assert res.status_code == 400
        assert "future dates" in res.json()["detail"].lower()

    def test_user_timezone_update_and_validation(self, db_session):
        headers, user = create_authenticated_user(db_session, "tz_update")
        # Valid update
        res = client.patch("/auth/me/timezone", json={"timezone": "Asia/Kolkata"}, headers=headers)
        assert res.status_code == 200
        assert res.json()["timezone"] == "Asia/Kolkata"

        # Invalid IANA timezone rejected
        res_bad = client.patch("/auth/me/timezone", json={"timezone": "Invalid/Timezone"}, headers=headers)
        assert res_bad.status_code == 422

    def test_cross_user_slot_and_override_ids_rejected(self, db_session):
        headers_a, user_a = create_authenticated_user(db_session, "user_a")
        headers_b, user_b = create_authenticated_user(db_session, "user_b")

        sem_a = client.post("/semesters", json={"name": "Sem A", "academic_year": "2026"}, headers=headers_a).json()
        subj_a = client.post(f"/semesters/{sem_a['id']}/subjects", json={"name": "Subject A"}, headers=headers_a).json()

        sem_b = client.post("/semesters", json={"name": "Sem B", "academic_year": "2026"}, headers=headers_b).json()
        subj_b = client.post(f"/semesters/{sem_b['id']}/subjects", json={"name": "Subject B"}, headers=headers_b).json()

        today_obj = get_user_today(user_a)
        # Slot belonging to user B
        slot_b = client.post(f"/semesters/{sem_b['id']}/timetable", json={
            "subject_id": subj_b["id"],
            "day_of_week": today_obj.weekday(),
            "start_time": "09:00:00",
            "end_time": "10:00:00",
            "effective_from": (today_obj - timedelta(days=10)).isoformat(),
        }, headers=headers_b).json()

        # Slot belonging to user A
        slot_a = client.post(f"/semesters/{sem_a['id']}/timetable", json={
            "subject_id": subj_a["id"],
            "day_of_week": today_obj.weekday(),
            "start_time": "09:00:00",
            "end_time": "10:00:00",
            "effective_from": (today_obj - timedelta(days=10)).isoformat(),
        }, headers=headers_a).json()

        # User A tries to record attendance referencing User B's slot_id
        res_cross = client.post(f"/semesters/{sem_a['id']}/lectures/attendance", json={
            "subject_id": subj_a["id"],
            "lecture_date": today_obj.isoformat(),
            "start_time": "09:00:00",
            "end_time": "10:00:00",
            "status": "attended",
            "timetable_slot_id": slot_b["id"],
        }, headers=headers_a)
        assert res_cross.status_code == 400
        assert "not found" in res_cross.json()["detail"].lower()

    def test_attendance_for_nonexistent_lecture_rejected(self, db_session):
        headers, user = create_authenticated_user(db_session, "nonexistent")
        sem = client.post("/semesters", json={"name": "Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Subject"}, headers=headers).json()

        past_date = (date.today() - timedelta(days=3)).isoformat()
        # Attempt recording attendance at 03:00 where no slot or override exists
        res = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": past_date,
            "start_time": "03:00:00",
            "end_time": "04:00:00",
            "status": "attended",
        }, headers=headers)
        assert res.status_code == 400
        assert "no scheduled lecture found" in res.json()["detail"].lower()

    def test_attendance_on_cancelled_lecture_rejected(self, db_session):
        headers, user = create_authenticated_user(db_session, "cancelled_att")
        sem = client.post("/semesters", json={"name": "Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "History"}, headers=headers).json()

        past_obj = date.today() - timedelta(days=3)
        past_date = past_obj.isoformat()

        slot = client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj["id"],
            "day_of_week": past_obj.weekday(),
            "start_time": "11:00:00",
            "end_time": "12:00:00",
            "effective_from": (past_obj - timedelta(days=10)).isoformat(),
        }, headers=headers).json()

        # Create cancellation override
        client.post(f"/semesters/{sem['id']}/overrides", json={
            "subject_id": subj["id"],
            "override_type": "cancelled",
            "timetable_slot_id": slot["id"],
            "original_date": past_date,
            "target_date": past_date,
            "start_time": "11:00:00",
            "end_time": "12:00:00",
            "note": "Snow day",
        }, headers=headers)

        # Attempt marking "attended" on cancelled lecture
        res_att = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": past_date,
            "start_time": "11:00:00",
            "end_time": "12:00:00",
            "status": "attended",
        }, headers=headers)
        assert res_att.status_code == 400
        assert "cancelled" in res_att.json()["detail"].lower()

        # Attempt marking "missed" on cancelled lecture
        res_miss = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": past_date,
            "start_time": "11:00:00",
            "end_time": "12:00:00",
            "status": "missed",
        }, headers=headers)
        assert res_miss.status_code == 400
        assert "cancelled" in res_miss.json()["detail"].lower()

        # Marking "class_cancelled" is allowed
        res_canc = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": past_date,
            "start_time": "11:00:00",
            "end_time": "12:00:00",
            "status": "class_cancelled",
        }, headers=headers)
        assert res_canc.status_code == 200
        assert res_canc.json()["status"] == "class_cancelled"

    def test_valid_historical_attendance_correction_after_slot_deletion(self, db_session):
        headers, user = create_authenticated_user(db_session, "hist_correct")
        sem = client.post("/semesters", json={"name": "Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Biology"}, headers=headers).json()

        past_obj = date.today() - timedelta(days=4)
        past_date = past_obj.isoformat()

        slot = client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj["id"],
            "day_of_week": past_obj.weekday(),
            "start_time": "14:00:00",
            "end_time": "15:00:00",
            "effective_from": (past_obj - timedelta(days=10)).isoformat(),
        }, headers=headers).json()

        # Record attendance while slot is active
        res_initial = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": past_date,
            "start_time": "14:00:00",
            "end_time": "15:00:00",
            "status": "missed",
            "timetable_slot_id": slot["id"],
        }, headers=headers)
        assert res_initial.status_code == 200

        # Now delete the timetable slot
        client.delete(f"/semesters/{sem['id']}/timetable/{slot['id']}", headers=headers)

        # Correct the historical attendance from missed to attended
        res_correct = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": past_date,
            "start_time": "14:00:00",
            "end_time": "15:00:00",
            "status": "attended",
        }, headers=headers)
        assert res_correct.status_code == 200
        assert res_correct.json()["status"] == "attended"

    def test_extra_lecture_conflict_with_regular_and_rescheduled(self, db_session):
        headers, user = create_authenticated_user(db_session, "extra_conflict")
        sem = client.post("/semesters", json={"name": "Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Art"}, headers=headers).json()

        target_obj = date.today() - timedelta(days=2)
        target_date = target_obj.isoformat()

        # Regular slot on that weekday: 10:00 - 11:30
        client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj["id"],
            "day_of_week": target_obj.weekday(),
            "start_time": "10:00:00",
            "end_time": "11:30:00",
            "effective_from": (target_obj - timedelta(days=10)).isoformat(),
        }, headers=headers)

        # Attempt extra lecture overlapping regular slot (10:30 - 12:00)
        res_clash = client.post(f"/semesters/{sem['id']}/overrides", json={
            "subject_id": subj["id"],
            "override_type": "extra",
            "target_date": target_date,
            "start_time": "10:30:00",
            "end_time": "12:00:00",
            "note": "Extra help",
        }, headers=headers)
        assert res_clash.status_code == 400
        assert "regular lecture already exists" in res_clash.json()["detail"].lower()

    def test_override_subject_mismatch_rejected(self, db_session):
        headers, user = create_authenticated_user(db_session, "subj_mismatch")
        sem = client.post("/semesters", json={"name": "Sem", "academic_year": "2026"}, headers=headers).json()
        subj_a = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Subj A"}, headers=headers).json()
        subj_b = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Subj B"}, headers=headers).json()

        slot_a = client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj_a["id"],
            "day_of_week": 1,
            "start_time": "09:00:00",
            "end_time": "10:00:00",
            "effective_from": "2026-09-01",
        }, headers=headers).json()

        # Attempt to create override for Subj B referencing slot of Subj A
        res = client.post(f"/semesters/{sem['id']}/overrides", json={
            "subject_id": subj_b["id"],
            "override_type": "cancelled",
            "timetable_slot_id": slot_a["id"],
            "original_date": "2026-09-08",
            "target_date": "2026-09-08",
            "start_time": "09:00:00",
            "end_time": "10:00:00",
        }, headers=headers)
        assert res.status_code == 400
        assert "does not belong to the specified subject" in res.json()["detail"].lower()

    def test_timetable_slot_update_outside_semester_bounds_rejected(self, db_session):
        headers, user = create_authenticated_user(db_session, "bounds_update")
        sem = client.post("/semesters", json={
            "name": "Bounded Sem",
            "academic_year": "2026",
            "start_date": "2026-09-01",
            "end_date": "2026-12-20",
        }, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Economics"}, headers=headers).json()

        slot = client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj["id"],
            "day_of_week": 2,
            "start_time": "13:00:00",
            "end_time": "14:00:00",
            "effective_from": "2026-09-01",
            "effective_to": "2026-12-20",
        }, headers=headers).json()

        # Update effective_to before semester start_date
        res_before = client.put(f"/semesters/{sem['id']}/timetable/{slot['id']}", json={
            "effective_from": "2026-08-01",
            "effective_to": "2026-08-25",
        }, headers=headers)
        assert res_before.status_code == 400
        assert "before semester start_date" in res_before.json()["detail"].lower()

        # Update effective_from after semester end_date
        res_after = client.put(f"/semesters/{sem['id']}/timetable/{slot['id']}", json={
            "effective_from": "2026-12-25",
            "effective_to": "2026-12-30",
        }, headers=headers)
        assert res_after.status_code == 400
        assert "after semester end_date" in res_after.json()["detail"].lower()

    def test_delete_lecture_attendance_endpoint(self, db_session):
        headers, user = create_authenticated_user(db_session, "del_att")
        sem = client.post("/semesters", json={"name": "Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Drama"}, headers=headers).json()

        past_obj = date.today() - timedelta(days=2)
        past_date = past_obj.isoformat()

        client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj["id"],
            "day_of_week": past_obj.weekday(),
            "start_time": "16:00:00",
            "end_time": "17:00:00",
            "effective_from": (past_obj - timedelta(days=10)).isoformat(),
        }, headers=headers)

        att = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": past_date,
            "start_time": "16:00:00",
            "end_time": "17:00:00",
            "status": "attended",
        }, headers=headers).json()

        # Delete it
        del_res = client.delete(f"/semesters/{sem['id']}/lectures/attendance/{att['id']}", headers=headers)
        assert del_res.status_code == 204

        # Verify it's gone
        list_res = client.get(f"/semesters/{sem['id']}/lectures/attendance", headers=headers).json()
        assert len(list_res) == 0

    def test_extra_lecture_on_holiday_can_be_marked_attended(self, db_session):
        headers, user = create_authenticated_user(db_session, "extra_holiday")
        sem = client.post("/semesters", json={"name": "Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Physics"}, headers=headers).json()

        past_obj = date.today() - timedelta(days=2)
        past_date = past_obj.isoformat()

        # Create a calendar event cancelling regular classes on past_date
        client.post(f"/semesters/{sem['id']}/calendar", json={
            "title": "Public Holiday",
            "event_type": "holiday",
            "start_date": past_date,
            "end_date": past_date,
            "cancels_regular_classes": True,
        }, headers=headers)

        # Create an extra lecture override on that holiday
        extra = client.post(f"/semesters/{sem['id']}/overrides", json={
            "subject_id": subj["id"],
            "override_type": "extra",
            "target_date": past_date,
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "note": "Special holiday prep session",
        }, headers=headers).json()

        # Schedule resolution reports it as not cancelled
        lectures = client.get(f"/semesters/{sem['id']}/lectures?from_date={past_date}&to_date={past_date}", headers=headers).json()
        assert len(lectures) == 1
        assert lectures[0]["is_cancelled"] is False

        # Attendance can be marked as attended for this extra lecture
        att_res = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": past_date,
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "status": "attended",
            "override_id": extra["id"],
        }, headers=headers)
        assert att_res.status_code == 200
        assert att_res.json()["status"] == "attended"

    def test_extra_lecture_on_holiday_can_be_marked_missed(self, db_session):
        headers, user = create_authenticated_user(db_session, "extra_missed")
        sem = client.post("/semesters", json={"name": "Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Chemistry"}, headers=headers).json()

        past_obj = date.today() - timedelta(days=3)
        past_date = past_obj.isoformat()

        # Calendar holiday cancelling regular classes
        client.post(f"/semesters/{sem['id']}/calendar", json={
            "title": "Memorial Holiday",
            "event_type": "holiday",
            "start_date": past_date,
            "end_date": past_date,
            "cancels_regular_classes": True,
        }, headers=headers)

        # Extra lecture override
        extra = client.post(f"/semesters/{sem['id']}/overrides", json={
            "subject_id": subj["id"],
            "override_type": "extra",
            "target_date": past_date,
            "start_time": "14:00:00",
            "end_time": "15:00:00",
            "note": "Makeup lab",
        }, headers=headers).json()

        # Mark as missed
        att_res = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": past_date,
            "start_time": "14:00:00",
            "end_time": "15:00:00",
            "status": "missed",
            "override_id": extra["id"],
        }, headers=headers)
        assert att_res.status_code == 200
        assert att_res.json()["status"] == "missed"

    def test_regular_lecture_on_holiday_remains_cancelled(self, db_session):
        headers, user = create_authenticated_user(db_session, "reg_holiday")
        sem = client.post("/semesters", json={"name": "Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "Math"}, headers=headers).json()

        past_obj = date.today() - timedelta(days=2)
        past_date = past_obj.isoformat()

        # Calendar holiday cancelling regular classes
        client.post(f"/semesters/{sem['id']}/calendar", json={
            "title": "Campus Closed",
            "event_type": "holiday",
            "start_date": past_date,
            "end_date": past_date,
            "cancels_regular_classes": True,
        }, headers=headers)

        # Regular timetable slot on this day of week: 08:00 - 09:00
        client.post(f"/semesters/{sem['id']}/timetable", json={
            "subject_id": subj["id"],
            "day_of_week": past_obj.weekday(),
            "start_time": "08:00:00",
            "end_time": "09:00:00",
            "effective_from": (past_obj - timedelta(days=10)).isoformat(),
        }, headers=headers)

        # Extra lecture override on that same holiday: 11:00 - 12:00
        client.post(f"/semesters/{sem['id']}/overrides", json={
            "subject_id": subj["id"],
            "override_type": "extra",
            "target_date": past_date,
            "start_time": "11:00:00",
            "end_time": "12:00:00",
            "note": "Optional tutorial",
        }, headers=headers)

        # Regular lecture at 08:00 MUST remain cancelled and cannot be marked attended or missed
        res_att = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": past_date,
            "start_time": "08:00:00",
            "end_time": "09:00:00",
            "status": "attended",
        }, headers=headers)
        assert res_att.status_code == 400
        assert "cancelled" in res_att.json()["detail"].lower()

        res_miss = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": past_date,
            "start_time": "08:00:00",
            "end_time": "09:00:00",
            "status": "missed",
        }, headers=headers)
        assert res_miss.status_code == 400
        assert "cancelled" in res_miss.json()["detail"].lower()

    def test_extra_lecture_explicitly_cancelled_cannot_be_marked_attended(self, db_session):
        headers, user = create_authenticated_user(db_session, "extra_canc")
        sem = client.post("/semesters", json={"name": "Sem", "academic_year": "2026"}, headers=headers).json()
        subj = client.post(f"/semesters/{sem['id']}/subjects", json={"name": "English"}, headers=headers).json()

        past_obj = date.today() - timedelta(days=2)
        past_date = past_obj.isoformat()

        # Create extra lecture override: 16:00 - 17:00
        extra = client.post(f"/semesters/{sem['id']}/overrides", json={
            "subject_id": subj["id"],
            "override_type": "extra",
            "target_date": past_date,
            "start_time": "16:00:00",
            "end_time": "17:00:00",
            "note": "Review session",
        }, headers=headers).json()

        # Explicit cancellation override for that extra lecture
        client.post(f"/semesters/{sem['id']}/overrides", json={
            "subject_id": subj["id"],
            "override_type": "cancelled",
            "original_date": past_date,
            "target_date": past_date,
            "start_time": "16:00:00",
            "end_time": "17:00:00",
            "note": "Cancelled review session",
        }, headers=headers)

        # Attempting to mark attended on the cancelled extra lecture must be rejected
        res = client.post(f"/semesters/{sem['id']}/lectures/attendance", json={
            "subject_id": subj["id"],
            "lecture_date": past_date,
            "start_time": "16:00:00",
            "end_time": "17:00:00",
            "status": "attended",
            "override_id": extra["id"],
        }, headers=headers)
        assert res.status_code == 400
        assert "cancelled" in res.json()["detail"].lower()
