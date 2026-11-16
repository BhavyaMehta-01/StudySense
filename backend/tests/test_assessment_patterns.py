from datetime import date
from decimal import Decimal
import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.database import engine, Base, SessionLocal
from app.models import (
    User,
    Semester,
    Subject,
    Assessment,
    AssessmentPattern,
    AssessmentPatternComponent,
    AcademicCalendarEvent,
)
from app.schemas import (
    AssessmentPatternCreate,
    AssessmentPatternComponentCreate,
    AssessmentResponse,
)


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


def create_user_semester_subject(db_session, user_suffix="1"):
    user = User(
        email=f"pattern_test_{user_suffix}@example.com",
        password_hash="fakehash",
        name="Pattern User",
    )
    db_session.add(user)
    db_session.flush()

    semester = Semester(
        user_id=user.id,
        name="Fall 2026",
        academic_year="2026-2027",
        start_date=date(2026, 8, 1),
        end_date=date(2026, 12, 15),
    )
    db_session.add(semester)
    db_session.flush()

    subject = Subject(semester_id=semester.id, name="Data Structures", code="CS201")
    db_session.add(subject)
    db_session.flush()

    return user, semester, subject


def test_create_assessment_pattern_for_subject(db_session):
    _, _, subject = create_user_semester_subject(db_session, "create_pat")

    pattern = AssessmentPattern(
        subject_id=subject.id,
        name="Standard Engineering 2026",
        is_active=True,
    )
    db_session.add(pattern)
    db_session.flush()

    assert pattern.id is not None
    assert pattern.is_active is True
    assert pattern.subject_id == subject.id
    assert len(subject.assessment_patterns) == 1
    assert subject.assessment_patterns[0].name == "Standard Engineering 2026"


def test_multiple_components_different_marks_and_weights(db_session):
    _, _, subject = create_user_semester_subject(db_session, "multi_comp")

    pattern = AssessmentPattern(
        subject_id=subject.id,
        name="Tiered Grading Pattern",
        is_active=True,
    )
    db_session.add(pattern)
    db_session.flush()

    c1 = AssessmentPatternComponent(
        pattern_id=pattern.id,
        name="Internal Test 1",
        category="internal_test",
        max_marks=Decimal("50.00"),
        weightage=Decimal("20.00"),
        order_index=1,
    )
    c2 = AssessmentPatternComponent(
        pattern_id=pattern.id,
        name="Mid-Semester Exam",
        category="midsem",
        max_marks=Decimal("100.00"),
        weightage=Decimal("30.00"),
        order_index=2,
    )
    c3 = AssessmentPatternComponent(
        pattern_id=pattern.id,
        name="Laboratory Assessment",
        category="practical",
        max_marks=Decimal("25.00"),
        weightage=Decimal("10.00"),
        order_index=3,
    )
    c4 = AssessmentPatternComponent(
        pattern_id=pattern.id,
        name="End-Semester Exam",
        category="endsem",
        max_marks=Decimal("100.00"),
        weightage=Decimal("40.00"),
        order_index=4,
    )

    db_session.add_all([c1, c2, c3, c4])
    db_session.flush()

    assert len(pattern.components) == 4
    # verify ordered retrieval
    components = pattern.components
    assert [c.name for c in components] == [
        "Internal Test 1",
        "Mid-Semester Exam",
        "Laboratory Assessment",
        "End-Semester Exam",
    ]
    assert components[0].max_marks == Decimal("50.00")
    assert components[0].weightage == Decimal("20.00")
    assert sum(c.weightage for c in components) == Decimal("100.00")


def test_prevent_invalid_marks_and_weightages(db_session):
    _, _, subject = create_user_semester_subject(db_session, "invalid_marks")
    pattern = AssessmentPattern(subject_id=subject.id, name="Test Pattern")
    db_session.add(pattern)
    db_session.flush()

    # 1. max_marks <= 0 violates chk_pattern_components_max_marks
    bad_max = AssessmentPatternComponent(
        pattern_id=pattern.id,
        name="Zero Max",
        category="quiz",
        max_marks=Decimal("0.00"),
        weightage=Decimal("10.00"),
    )
    db_session.add(bad_max)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

    # Re-fetch or re-create pattern after rollback
    _, _, subject = create_user_semester_subject(db_session, "invalid_weight")
    pattern = AssessmentPattern(subject_id=subject.id, name="Test Pattern 2")
    db_session.add(pattern)
    db_session.flush()

    # 2. weightage > 100 violates chk_pattern_components_weightage
    bad_weight = AssessmentPatternComponent(
        pattern_id=pattern.id,
        name="Huge Weight",
        category="quiz",
        max_marks=Decimal("100.00"),
        weightage=Decimal("120.00"),
    )
    db_session.add(bad_weight)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

    # 3. Invalid category violates chk_pattern_components_category
    _, _, subject = create_user_semester_subject(db_session, "invalid_cat")
    pattern = AssessmentPattern(subject_id=subject.id, name="Test Pattern 3")
    db_session.add(pattern)
    db_session.flush()

    bad_cat = AssessmentPatternComponent(
        pattern_id=pattern.id,
        name="Bad Cat",
        category="unsupported_category",
        max_marks=Decimal("10.00"),
        weightage=Decimal("10.00"),
    )
    db_session.add(bad_cat)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

    # 4. Zero weightage on active component violates chk_pattern_components_weightage
    _, _, subject = create_user_semester_subject(db_session, "zero_active_weight")
    pattern = AssessmentPattern(subject_id=subject.id, name="Test Pattern 4")
    db_session.add(pattern)
    db_session.flush()

    zero_active = AssessmentPatternComponent(
        pattern_id=pattern.id,
        name="Zero Active Weight",
        category="quiz",
        max_marks=Decimal("10.00"),
        weightage=Decimal("0.00"),
        is_active=True,
    )
    db_session.add(zero_active)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

    # 5. Negative weightage violates chk_pattern_components_weightage (active or inactive)
    _, _, subject = create_user_semester_subject(db_session, "negative_weight")
    pattern = AssessmentPattern(subject_id=subject.id, name="Test Pattern 5")
    db_session.add(pattern)
    db_session.flush()

    neg_comp = AssessmentPatternComponent(
        pattern_id=pattern.id,
        name="Negative Weight",
        category="quiz",
        max_marks=Decimal("10.00"),
        weightage=Decimal("-5.00"),
        is_active=False,
    )
    db_session.add(neg_comp)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

    # 6. Inactive component with zero weightage is permitted in DB
    _, _, subject = create_user_semester_subject(db_session, "zero_inactive_ok")
    pattern = AssessmentPattern(subject_id=subject.id, name="Test Pattern 6")
    db_session.add(pattern)
    db_session.flush()

    zero_inactive = AssessmentPatternComponent(
        pattern_id=pattern.id,
        name="Zero Inactive Allowed",
        category="quiz",
        max_marks=Decimal("10.00"),
        weightage=Decimal("0.00"),
        is_active=False,
    )
    db_session.add(zero_inactive)
    db_session.flush()
    assert zero_inactive.id is not None
    assert zero_inactive.is_valid_for_generation is False

    # 7. Valid positive weightage and upper-bound (100.00) succeed
    valid_100 = AssessmentPatternComponent(
        pattern_id=pattern.id,
        name="Full Weight Exam",
        category="endsem",
        max_marks=Decimal("100.00"),
        weightage=Decimal("100.00"),
        is_active=True,
    )
    db_session.add(valid_100)
    db_session.flush()
    assert valid_100.id is not None
    assert valid_100.is_valid_for_generation is True


def test_schema_validations():
    # Schema validation for component - invalid max marks
    with pytest.raises(ValidationError):
        AssessmentPatternComponentCreate(
            name="Test",
            category="quiz",
            max_marks=Decimal("0"),
            weightage=Decimal("10"),
        )

    # Schema validation for component - weightage > 100
    with pytest.raises(ValidationError):
        AssessmentPatternComponentCreate(
            name="Test",
            category="quiz",
            max_marks=Decimal("50"),
            weightage=Decimal("150"),
        )

    # Schema validation for component - active component with zero weightage rejected
    with pytest.raises(ValidationError, match="Active assessment pattern components must have weightage greater than 0"):
        AssessmentPatternComponentCreate(
            name="Test",
            category="quiz",
            max_marks=Decimal("50"),
            weightage=Decimal("0"),
            is_active=True,
        )

    # Schema validation for component - active component with negative weightage rejected
    with pytest.raises(ValidationError):
        AssessmentPatternComponentCreate(
            name="Test",
            category="quiz",
            max_marks=Decimal("50"),
            weightage=Decimal("-10"),
            is_active=True,
        )

    # Schema validation for component - inactive component with zero weightage is allowed
    inactive_zero = AssessmentPatternComponentCreate(
        name="Draft Inactive",
        category="quiz",
        max_marks=Decimal("50"),
        weightage=Decimal("0"),
        is_active=False,
    )
    assert inactive_zero.weightage == Decimal("0")
    assert inactive_zero.is_active is False

    # Schema validation for component - valid upper bound 100 is allowed
    comp_100 = AssessmentPatternComponentCreate(
        name="Solo 100",
        category="endsem",
        max_marks=Decimal("100"),
        weightage=Decimal("100"),
        is_active=True,
    )
    assert comp_100.weightage == Decimal("100")

    # Schema validation for component update - active with zero weightage rejected
    from app.schemas import AssessmentPatternComponentUpdate
    with pytest.raises(ValidationError, match="Active assessment pattern components must have weightage greater than 0"):
        AssessmentPatternComponentUpdate(
            is_active=True,
            weightage=Decimal("0"),
        )

    # Schema validation for pattern sum of active components
    with pytest.raises(ValidationError, match="Total weightage of active components cannot exceed 100"):
        AssessmentPatternCreate(
            name="Too Heavy Pattern",
            components=[
                AssessmentPatternComponentCreate(
                    name="Part 1",
                    category="midsem",
                    max_marks=Decimal("100"),
                    weightage=Decimal("60"),
                ),
                AssessmentPatternComponentCreate(
                    name="Part 2",
                    category="endsem",
                    max_marks=Decimal("100"),
                    weightage=Decimal("50"),
                ),
            ],
        )


def test_at_most_one_active_pattern_per_subject(db_session):
    _, _, subject = create_user_semester_subject(db_session, "single_active")

    p1 = AssessmentPattern(subject_id=subject.id, name="Active 1", is_active=True)
    db_session.add(p1)
    db_session.flush()

    # Second active pattern for the same subject should violate partial unique index
    p2 = AssessmentPattern(subject_id=subject.id, name="Active 2", is_active=True)
    db_session.add(p2)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

    # Creating an inactive pattern alongside an active pattern should succeed
    _, _, subject = create_user_semester_subject(db_session, "one_active_one_inactive")
    active_pattern = AssessmentPattern(subject_id=subject.id, name="Active", is_active=True)
    inactive_pattern = AssessmentPattern(subject_id=subject.id, name="Inactive Draft", is_active=False)
    db_session.add_all([active_pattern, inactive_pattern])
    db_session.flush()

    assert active_pattern.id is not None
    assert inactive_pattern.id is not None


def test_subject_cascade_deletes_pattern(db_session):
    _, _, subject = create_user_semester_subject(db_session, "cascade_subj")
    pattern = AssessmentPattern(subject_id=subject.id, name="To Delete")
    db_session.add(pattern)
    db_session.flush()

    comp = AssessmentPatternComponent(
        pattern_id=pattern.id,
        name="Quiz 1",
        category="quiz",
        max_marks=Decimal("20.00"),
        weightage=Decimal("10.00"),
    )
    db_session.add(comp)
    db_session.flush()

    pat_id = pattern.id
    comp_id = comp.id

    db_session.delete(subject)
    db_session.flush()

    assert db_session.get(AssessmentPattern, pat_id) is None
    assert db_session.get(AssessmentPatternComponent, comp_id) is None


def test_existing_assessment_compatibility_and_null_fields(db_session):
    _, _, subject = create_user_semester_subject(db_session, "compat")

    # Regular assessment without calendar or pattern linkages
    assessment = Assessment(
        subject_id=subject.id,
        name="Standard Assignment",
        category="assignment",
        max_marks=Decimal("100.00"),
        marks=Decimal("88.00"),
        weightage=Decimal("20.00"),
        status="scored",
    )
    db_session.add(assessment)
    db_session.flush()

    assert assessment.id is not None
    assert assessment.calendar_event_id is None
    assert assessment.pattern_component_id is None
    assert assessment.is_auto_generated is False

    # Schema serialisation verification
    resp = AssessmentResponse.model_validate(assessment)
    assert resp.calendar_event_id is None
    assert resp.pattern_component_id is None
    assert resp.is_auto_generated is False


def test_deleting_calendar_event_sets_null_on_assessment(db_session):
    _, semester, subject = create_user_semester_subject(db_session, "cal_delete")

    event = AcademicCalendarEvent(
        semester_id=semester.id,
        title="Midterm Exam Week",
        event_type="exam",
        start_date=date(2026, 10, 10),
        end_date=date(2026, 10, 15),
    )
    db_session.add(event)
    db_session.flush()

    assessment = Assessment(
        subject_id=subject.id,
        name="Midterm Exam - DS",
        category="midsem",
        max_marks=Decimal("100.00"),
        marks=Decimal("75.00"),
        weightage=Decimal("30.00"),
        status="scored",
        calendar_event_id=event.id,
        is_auto_generated=True,
    )
    db_session.add(assessment)
    db_session.flush()

    assessment_id = assessment.id

    # Delete the calendar event
    db_session.delete(event)
    db_session.flush()
    db_session.expire_all()

    # Assessment must still exist with preserved marks and nullified calendar_event_id
    reloaded = db_session.get(Assessment, assessment_id)
    assert reloaded is not None
    assert reloaded.calendar_event_id is None
    assert reloaded.marks == Decimal("75.00")
    assert reloaded.max_marks == Decimal("100.00")
    assert reloaded.weightage == Decimal("30.00")
    assert reloaded.is_auto_generated is True


def test_deleting_pattern_component_sets_null_on_assessment(db_session):
    _, _, subject = create_user_semester_subject(db_session, "comp_delete")

    pattern = AssessmentPattern(subject_id=subject.id, name="Engineering Pattern")
    db_session.add(pattern)
    db_session.flush()

    component = AssessmentPatternComponent(
        pattern_id=pattern.id,
        name="End-Semester Exam",
        category="endsem",
        max_marks=Decimal("100.00"),
        weightage=Decimal("50.00"),
    )
    db_session.add(component)
    db_session.flush()

    # Assessment captures snapshot values
    assessment = Assessment(
        subject_id=subject.id,
        name="End-Semester Exam",
        category=component.category,
        max_marks=component.max_marks,
        weightage=component.weightage,
        marks=Decimal("92.50"),
        status="scored",
        pattern_component_id=component.id,
    )
    db_session.add(assessment)
    db_session.flush()

    assessment_id = assessment.id

    # Delete the pattern component
    db_session.delete(component)
    db_session.flush()
    db_session.expire_all()

    # Assessment must still exist with preserved snapshot values
    reloaded = db_session.get(Assessment, assessment_id)
    assert reloaded is not None
    assert reloaded.pattern_component_id is None
    assert reloaded.marks == Decimal("92.50")
    assert reloaded.max_marks == Decimal("100.00")
    assert reloaded.weightage == Decimal("50.00")


def test_duplicate_generated_assessment_constraint(db_session):
    _, semester, subject = create_user_semester_subject(db_session, "dup_gen")

    event = AcademicCalendarEvent(
        semester_id=semester.id,
        title="Final Exam",
        event_type="exam",
        start_date=date(2026, 12, 1),
        end_date=date(2026, 12, 2),
    )
    db_session.add(event)
    db_session.flush()

    # First generated assessment
    a1 = Assessment(
        subject_id=subject.id,
        name="Final Exam - DS",
        category="endsem",
        max_marks=Decimal("100.00"),
        weightage=Decimal("40.00"),
        calendar_event_id=event.id,
        is_auto_generated=True,
    )
    db_session.add(a1)
    db_session.flush()

    # Attempt second assessment for same event and same subject
    a2 = Assessment(
        subject_id=subject.id,
        name="Duplicate Final Exam",
        category="endsem",
        max_marks=Decimal("100.00"),
        weightage=Decimal("40.00"),
        calendar_event_id=event.id,
        is_auto_generated=True,
    )
    db_session.add(a2)
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

    # Manually created assessments with calendar_event_id=None should allow multiple per subject
    _, _, subject = create_user_semester_subject(db_session, "manual_mult")
    m1 = Assessment(
        subject_id=subject.id,
        name="Quiz 1",
        category="quiz",
        max_marks=Decimal("20.00"),
        weightage=Decimal("10.00"),
        calendar_event_id=None,
    )
    m2 = Assessment(
        subject_id=subject.id,
        name="Quiz 2",
        category="quiz",
        max_marks=Decimal("20.00"),
        weightage=Decimal("10.00"),
        calendar_event_id=None,
    )
    db_session.add_all([m1, m2])
    db_session.flush()

    assert m1.id is not None
    assert m2.id is not None
