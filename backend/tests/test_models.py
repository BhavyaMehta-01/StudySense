import pytest
from datetime import date
from sqlalchemy.exc import IntegrityError
from app.database import engine, Base, SessionLocal
from app.models import User, Semester, Subject, Assessment, Attendance, StudyPlan, StudyPlanAllocation, StudySession

@pytest.fixture(scope="module")
def setup_database():
    Base.metadata.create_all(bind=engine)
    yield

@pytest.fixture
def db_session(setup_database):
    connection = engine.connect()
    transaction = connection.begin()
    session = SessionLocal(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()

def test_relationships(db_session):
    user = User(email="test@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()

    semester = Semester(user_id=user.id, name="Fall 2026", academic_year="2026-2027")
    db_session.add(semester)
    db_session.flush()

    subject = Subject(semester_id=semester.id, name="Math")
    db_session.add(subject)
    db_session.flush()

    assessment = Assessment(subject_id=subject.id, name="Midterm", category="midsem", max_marks=100)
    db_session.add(assessment)

    attendance = Attendance(subject_id=subject.id, classes_attended=10, classes_held=12, recorded_on=date.today())
    db_session.add(attendance)
    db_session.flush()

    assert len(user.semesters) == 1
    assert user.semesters[0].name == "Fall 2026"
    assert len(semester.subjects) == 1
    assert semester.subjects[0].name == "Math"
    assert len(subject.assessments) == 1
    assert len(subject.attendances) == 1

def test_invalid_marks_above_max(db_session):
    user = User(email="test2@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()
    semester = Semester(user_id=user.id, name="Fall", academic_year="2026")
    db_session.add(semester)
    db_session.flush()
    subject = Subject(semester_id=semester.id, name="Math")
    db_session.add(subject)
    db_session.flush()

    assessment = Assessment(subject_id=subject.id, name="Midterm", category="midsem", max_marks=100, marks=105)
    db_session.add(assessment)
    with pytest.raises(IntegrityError):
        db_session.flush()

def test_negative_marks(db_session):
    user = User(email="test3@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()
    semester = Semester(user_id=user.id, name="Fall", academic_year="2026")
    db_session.add(semester)
    db_session.flush()
    subject = Subject(semester_id=semester.id, name="Math")
    db_session.add(subject)
    db_session.flush()

    assessment = Assessment(subject_id=subject.id, name="Midterm", category="midsem", max_marks=100, marks=-5)
    db_session.add(assessment)
    with pytest.raises(IntegrityError):
        db_session.flush()

def test_invalid_max_marks(db_session):
    user = User(email="test4@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()
    semester = Semester(user_id=user.id, name="Fall", academic_year="2026")
    db_session.add(semester)
    db_session.flush()
    subject = Subject(semester_id=semester.id, name="Math")
    db_session.add(subject)
    db_session.flush()

    assessment = Assessment(subject_id=subject.id, name="Midterm", category="midsem", max_marks=0)
    db_session.add(assessment)
    with pytest.raises(IntegrityError):
        db_session.flush()

def test_invalid_weightage(db_session):
    user = User(email="test5@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()
    semester = Semester(user_id=user.id, name="Fall", academic_year="2026")
    db_session.add(semester)
    db_session.flush()
    subject = Subject(semester_id=semester.id, name="Math")
    db_session.add(subject)
    db_session.flush()

    assessment = Assessment(subject_id=subject.id, name="Midterm", category="midsem", max_marks=100, weightage=105)
    db_session.add(assessment)
    with pytest.raises(IntegrityError):
        db_session.flush()

def test_invalid_attendance(db_session):
    user = User(email="test6@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()
    semester = Semester(user_id=user.id, name="Fall", academic_year="2026")
    db_session.add(semester)
    db_session.flush()
    subject = Subject(semester_id=semester.id, name="Math")
    db_session.add(subject)
    db_session.flush()

    attendance = Attendance(subject_id=subject.id, classes_attended=15, classes_held=10, recorded_on=date.today())
    db_session.add(attendance)
    with pytest.raises(IntegrityError):
        db_session.flush()

def test_assessment_category_constraint(db_session):
    user = User(email="test7@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()
    semester = Semester(user_id=user.id, name="Fall", academic_year="2026")
    db_session.add(semester)
    db_session.flush()
    subject = Subject(semester_id=semester.id, name="Math")
    db_session.add(subject)
    db_session.flush()

    assessment = Assessment(subject_id=subject.id, name="Midterm", category="invalid_category", max_marks=100)
    db_session.add(assessment)
    with pytest.raises(IntegrityError):
        db_session.flush()

def test_assessment_status_constraint(db_session):
    user = User(email="test8@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()
    semester = Semester(user_id=user.id, name="Fall", academic_year="2026")
    db_session.add(semester)
    db_session.flush()
    subject = Subject(semester_id=semester.id, name="Math")
    db_session.add(subject)
    db_session.flush()

    assessment = Assessment(subject_id=subject.id, name="Midterm", category="midsem", max_marks=100, status="invalid_status")
    db_session.add(assessment)
    with pytest.raises(IntegrityError):
        db_session.flush()

def test_user_email_uniqueness(db_session):
    user1 = User(email="unique@example.com", password_hash="hash", name="Test")
    db_session.add(user1)
    db_session.flush()

    user2 = User(email="unique@example.com", password_hash="hash", name="Test2")
    db_session.add(user2)
    with pytest.raises(IntegrityError):
        db_session.flush()

def test_nullable_assessment_marks(db_session):
    user = User(email="test9@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()
    semester = Semester(user_id=user.id, name="Fall", academic_year="2026")
    db_session.add(semester)
    db_session.flush()
    subject = Subject(semester_id=semester.id, name="Math")
    db_session.add(subject)
    db_session.flush()

    assessment_none = Assessment(subject_id=subject.id, name="Midterm", category="midsem", max_marks=100, marks=None)
    assessment_zero = Assessment(subject_id=subject.id, name="Final", category="endsem", max_marks=100, marks=0)
    db_session.add_all([assessment_none, assessment_zero])
    db_session.flush()

    assert assessment_none.marks is None
    assert assessment_zero.marks == 0

def test_scored_assessment_null_marks(db_session):
    user = User(email="test10@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()
    semester = Semester(user_id=user.id, name="Fall", academic_year="2026")
    db_session.add(semester)
    db_session.flush()
    subject = Subject(semester_id=semester.id, name="Math")
    db_session.add(subject)
    db_session.flush()

    assessment = Assessment(subject_id=subject.id, name="Midterm", category="midsem", max_marks=100, status="scored", marks=None)
    db_session.add(assessment)
    with pytest.raises(IntegrityError):
        db_session.flush()

def test_subject_target_percentage(db_session):
    user = User(email="test11@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()
    semester = Semester(user_id=user.id, name="Fall", academic_year="2026")
    db_session.add(semester)
    db_session.flush()

    # Test NULL target percentage
    subject_null = Subject(semester_id=semester.id, name="Math")
    db_session.add(subject_null)

    # Test valid configured target percentage
    subject_target = Subject(semester_id=semester.id, name="Physics", target_percentage=85)
    db_session.add(subject_target)

    # Test 0 and 100 target percentage (should be valid)
    subject_zero = Subject(semester_id=semester.id, name="Chemistry", target_percentage=0)
    subject_hundred = Subject(semester_id=semester.id, name="Biology", target_percentage=100)
    db_session.add_all([subject_zero, subject_hundred])
    db_session.flush()

    assert subject_null.target_percentage is None
    assert subject_target.target_percentage == 85
    assert subject_zero.target_percentage == 0
    assert subject_hundred.target_percentage == 100

    # Test invalid target percentages
    subject_negative = Subject(semester_id=semester.id, name="History", target_percentage=-1)
    db_session.add(subject_negative)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

    user = User(email="test11_b@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()
    semester = Semester(user_id=user.id, name="Fall", academic_year="2026")
    db_session.add(semester)
    db_session.flush()

    subject_over = Subject(semester_id=semester.id, name="English", target_percentage=101)
    db_session.add(subject_over)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

def test_study_plan_constraints(db_session):
    user = User(email="test12@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()

    # Valid plan
    plan_valid = StudyPlan(user_id=user.id, start_date=date(2026, 1, 1), end_date=date(2026, 1, 7), available_minutes=600, is_active=False)
    db_session.add(plan_valid)
    db_session.flush()

    # Invalid: not positive minutes
    plan_zero = StudyPlan(user_id=user.id, start_date=date(2026, 1, 1), end_date=date(2026, 1, 7), available_minutes=0, is_active=False)
    db_session.add(plan_zero)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

    # Re-establish session state
    user = User(email="test12_b@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()

    # Invalid: not divisible by 5
    plan_indiv = StudyPlan(user_id=user.id, start_date=date(2026, 1, 1), end_date=date(2026, 1, 7), available_minutes=17, is_active=False)
    db_session.add(plan_indiv)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

    user = User(email="test12_c@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()

    # Invalid: dates reversed
    plan_dates = StudyPlan(user_id=user.id, start_date=date(2026, 1, 7), end_date=date(2026, 1, 1), available_minutes=600, is_active=False)
    db_session.add(plan_dates)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

def test_active_plan_uniqueness(db_session):
    user = User(email="test13@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()

    # multiple archived plans allowed
    p1 = StudyPlan(user_id=user.id, start_date=date(2026, 1, 1), end_date=date(2026, 1, 7), available_minutes=60, is_active=False)
    p2 = StudyPlan(user_id=user.id, start_date=date(2026, 1, 8), end_date=date(2026, 1, 14), available_minutes=60, is_active=False)
    db_session.add_all([p1, p2])
    db_session.flush()

    # one active plan allowed
    p3 = StudyPlan(user_id=user.id, start_date=date(2026, 1, 15), end_date=date(2026, 1, 21), available_minutes=60, is_active=True)
    db_session.add(p3)
    db_session.flush()

    # second active plan not allowed
    p4 = StudyPlan(user_id=user.id, start_date=date(2026, 1, 22), end_date=date(2026, 1, 28), available_minutes=60, is_active=True)
    db_session.add(p4)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

def test_subject_deletion_survivability(db_session):
    user = User(email="test14@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()

    semester = Semester(user_id=user.id, name="Fall", academic_year="2026")
    db_session.add(semester)
    db_session.flush()

    subject = Subject(semester_id=semester.id, name="Math")
    db_session.add(subject)
    db_session.flush()

    plan = StudyPlan(user_id=user.id, start_date=date(2026, 1, 1), end_date=date(2026, 1, 7), available_minutes=60, is_active=True)
    db_session.add(plan)
    db_session.flush()

    alloc = StudyPlanAllocation(plan_id=plan.id, subject_id=subject.id, allocated_minutes=60, snapshot_state={"foo": "bar"}, explanation_code="TEST")
    db_session.add(alloc)
    db_session.flush()

    # Delete the subject
    db_session.delete(subject)
    db_session.flush()

    # Fetch allocation to verify subject_id is null but allocation and snapshot survived
    db_session.expire_all()
    surviving_alloc = db_session.query(StudyPlanAllocation).filter_by(id=alloc.id).first()
    assert surviving_alloc is not None
    assert surviving_alloc.subject_id is None
    assert surviving_alloc.snapshot_state == {"foo": "bar"}

def test_session_constraints(db_session):
    user = User(email="test15@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()

    # valid session
    session_valid = StudySession(user_id=user.id, date=date.today(), duration_minutes=60, status="completed")
    db_session.add(session_valid)
    db_session.flush()

    # invalid status
    session_status = StudySession(user_id=user.id, date=date.today(), duration_minutes=60, status="invalid")
    db_session.add(session_status)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

    user = User(email="test15_b@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()

    # invalid duration
    session_duration = StudySession(user_id=user.id, date=date.today(), duration_minutes=-10, status="completed")
    db_session.add(session_duration)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

def test_session_survivability_archived_plan(db_session):
    """
    Test the approved V1b lifecycle where StudyPlans are archived (is_active=False)
    instead of hard-deleted, ensuring that historical allocations and sessions
    remain perfectly intact and connected.
    """
    user = User(email="test16@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()

    plan = StudyPlan(user_id=user.id, start_date=date(2026, 1, 1), end_date=date(2026, 1, 7), available_minutes=60, is_active=True)
    db_session.add(plan)
    db_session.flush()

    alloc = StudyPlanAllocation(plan_id=plan.id, allocated_minutes=60, snapshot_state={}, explanation_code="TEST")
    db_session.add(alloc)
    db_session.flush()

    sess = StudySession(user_id=user.id, allocation_id=alloc.id, date=date.today(), duration_minutes=30, status="completed")
    db_session.add(sess)
    db_session.flush()

    # Archive the plan (rebalance lifecycle)
    plan.is_active = False
    db_session.flush()
    db_session.expire_all()

    # Verify the plan, allocation, and session survive and are connected
    surviving_plan = db_session.query(StudyPlan).filter_by(id=plan.id).first()
    surviving_alloc = db_session.query(StudyPlanAllocation).filter_by(id=alloc.id).first()
    surviving_sess = db_session.query(StudySession).filter_by(id=sess.id).first()

    assert surviving_plan is not None
    assert not surviving_plan.is_active
    assert surviving_alloc is not None
    assert surviving_alloc.plan_id == plan.id
    assert surviving_sess is not None
    assert surviving_sess.allocation_id == alloc.id

def test_active_semester_uniqueness(db_session):
    user = User(email="test_sem_unique@example.com", password_hash="hash", name="Test")
    db_session.add(user)
    db_session.flush()

    # multiple inactive semesters allowed
    s1 = Semester(user_id=user.id, name="S1", academic_year="2026", is_active=False)
    s2 = Semester(user_id=user.id, name="S2", academic_year="2026", is_active=False)
    db_session.add_all([s1, s2])
    db_session.flush()

    # one active semester allowed
    s3 = Semester(user_id=user.id, name="S3", academic_year="2026", is_active=True)
    db_session.add(s3)
    db_session.flush()

    # second active semester not allowed
    s4 = Semester(user_id=user.id, name="S4", academic_year="2027", is_active=True)
    db_session.add(s4)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()
