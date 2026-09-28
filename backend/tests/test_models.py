import pytest
from datetime import date
from sqlalchemy.exc import IntegrityError
from app.database import engine, Base, SessionLocal
from app.models import User, Semester, Subject, Assessment, Attendance

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
