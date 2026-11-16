import pytest
from fastapi.testclient import TestClient
from app.main import app
from tests.test_academic_crud import get_token_for_user, setup_database, db_session
import io

client = TestClient(app)

def test_import_academic_preview_and_confirm(db_session):
    token, user_id = get_token_for_user(db_session, "import1@example.com", "Import 1")
    headers = {"Authorization": f"Bearer {token}"}
    
    csv_content = """semester,subject,assessment,category,status,max_marks,marks,weightage,scheduled_date
Sem 1,Math,Midterm,midsem,scored,100,80,40,2026-10-01
Sem 1,Math,Final,endsem,pending,100,,60,2026-12-01
"""
    file = {"file": ("data.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    
    # 1. Preview (dry_run=True)
    resp = client.post(
        "/import/csv", 
        headers=headers,
        data={"import_type": "academic", "dry_run": True},
        files=file
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert len(data["errors"]) == 0
    assert data["total_processed"] == 2
    assert data["imported_records"] == 2
    
    # Ensure dry-run creates no persistent semester, subject, or assessment records
    sems = client.get("/semesters", headers=headers).json()
    assert len(sems) == 0
    from app import models
    user_sems = db_session.query(models.Semester).filter_by(user_id=user_id).all()
    assert len(user_sems) == 0
    
    # 2. Confirm (dry_run=False)
    file = {"file": ("data.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    resp = client.post(
        "/import/csv", 
        headers=headers,
        data={"import_type": "academic", "dry_run": False},
        files=file
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    assert resp.json()["imported_records"] == 2
    
    # Ensure actually saved
    sems = client.get("/semesters", headers=headers).json()
    assert len(sems) == 1
    sem_id = sems[0]["id"]
    subjects = client.get(f"/semesters/{sem_id}/subjects", headers=headers).json()
    assert len(subjects) == 1
    assert subjects[0]["name"] == "Math"
    assessments = client.get(f"/subjects/{subjects[0]['id']}/assessments", headers=headers).json()
    assert len(assessments) == 2
    
def test_import_academic_validation_errors(db_session):
    token, user_id = get_token_for_user(db_session, "import2@example.com", "Import 2")
    headers = {"Authorization": f"Bearer {token}"}
    
    csv_content = """semester,subject,assessment,category,status,max_marks,marks,weightage
Sem 1,Math,Midterm,invalid_cat,scored,100,80,40
Sem 1,Math,Final,endsem,pending,100,,101
Sem 1,Math,Test1,quiz,scored,100,105,10
Sem 1,Math,Test2,quiz,scored,100,,10
"""
    # 1. Invalid dry-run returns success=false, 4 errors, and imports nothing
    file = {"file": ("data.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    resp = client.post(
        "/import/csv",
        headers=headers,
        data={"import_type": "academic", "dry_run": True},
        files=file
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert data["imported_records"] == 0
    assert len(data["errors"]) == 4

    sems = client.get("/semesters", headers=headers).json()
    assert len(sems) == 0

    # 2. Invalid confirm also returns success=false, 4 errors, and imports nothing
    file = {"file": ("data.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    resp = client.post(
        "/import/csv",
        headers=headers,
        data={"import_type": "academic", "dry_run": False},
        files=file
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert data["imported_records"] == 0
    assert len(data["errors"]) == 4
    
    # 101 weightage -> over 100
    # 105 marks -> marks > max_marks
    # invalid_cat
    # scored missing marks
    errors = [e["message"] for e in data["errors"]]
    assert any("Invalid category" in e for e in errors)
    assert any("Invalid weightage" in e for e in errors)
    assert any("Invalid marks" in e for e in errors)
    assert any("Marks are required when status is 'scored'" in e for e in errors)

    sems = client.get("/semesters", headers=headers).json()
    assert len(sems) == 0

def test_import_attendance(db_session):
    token, user_id = get_token_for_user(db_session, "import3@example.com", "Import 3")
    headers = {"Authorization": f"Bearer {token}"}
    
    csv_content = """semester,subject,classes_attended,classes_held,recorded_on
Sem 1,Physics,8,10,2026-10-01
"""
    # 1. Attendance preview dry-run
    file = {"file": ("data.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    resp = client.post(
        "/import/csv",
        headers=headers,
        data={"import_type": "attendance", "dry_run": True},
        files=file
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    assert resp.json()["imported_records"] == 1
    sems = client.get("/semesters", headers=headers).json()
    assert len(sems) == 0

    # 2. Attendance confirm
    file = {"file": ("data.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    resp = client.post(
        "/import/csv",
        headers=headers,
        data={"import_type": "attendance", "dry_run": False},
        files=file
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    assert resp.json()["imported_records"] == 1

def test_import_attendance_missing_classes_held_header(db_session):
    token, user_id = get_token_for_user(db_session, "import_missing_held@example.com", "Import Missing Held")
    headers = {"Authorization": f"Bearer {token}"}

    csv_content = """semester,subject,classes_attended,recorded_on
QA_Sandbox_2026,Software Testing,8,2026-04-25
"""
    file = {"file": ("data.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    resp = client.post(
        "/import/csv",
        headers=headers,
        data={"import_type": "attendance", "dry_run": True},
        files=file
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert data["total_processed"] == 0
    assert data["imported_records"] == 0
    assert len(data["errors"]) == 1
    assert data["errors"][0]["row"] == 1
    assert data["errors"][0]["column"] == "classes_held"
    assert "Missing required header(s): classes_held" in data["errors"][0]["message"]

    sems = client.get("/semesters", headers=headers).json()
    assert len(sems) == 0

def test_import_attendance_missing_classes_attended_header(db_session):
    token, user_id = get_token_for_user(db_session, "import_missing_att@example.com", "Import Missing Att")
    headers = {"Authorization": f"Bearer {token}"}

    csv_content = """semester,subject,classes_held,recorded_on
QA_Sandbox_2026,Software Testing,10,2026-04-25
"""
    file = {"file": ("data.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    resp = client.post(
        "/import/csv",
        headers=headers,
        data={"import_type": "attendance", "dry_run": False},
        files=file
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert data["total_processed"] == 0
    assert data["imported_records"] == 0
    assert len(data["errors"]) == 1
    assert data["errors"][0]["row"] == 1
    assert data["errors"][0]["column"] == "classes_attended"
    assert "Missing required header(s): classes_attended" in data["errors"][0]["message"]

    sems = client.get("/semesters", headers=headers).json()
    assert len(sems) == 0

def test_import_academic_missing_required_header(db_session):
    token, user_id = get_token_for_user(db_session, "import_missing_academic@example.com", "Import Missing Academic")
    headers = {"Authorization": f"Bearer {token}"}

    # Missing max_marks header
    csv_content = """semester,subject,assessment,category,status,marks,weightage,scheduled_date
Sem 1,Math,Midterm,midsem,scored,80,40,2026-10-01
"""
    file = {"file": ("data.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    resp = client.post(
        "/import/csv",
        headers=headers,
        data={"import_type": "academic", "dry_run": True},
        files=file
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert data["total_processed"] == 0
    assert data["imported_records"] == 0
    assert len(data["errors"]) == 1
    assert data["errors"][0]["row"] == 1
    assert data["errors"][0]["column"] == "max_marks"
    assert "Missing required header(s): max_marks" in data["errors"][0]["message"]

    sems = client.get("/semesters", headers=headers).json()
    assert len(sems) == 0

def test_import_multiple_missing_headers(db_session):
    token, user_id = get_token_for_user(db_session, "import_multi_missing@example.com", "Import Multi Missing")
    headers = {"Authorization": f"Bearer {token}"}

    # Missing classes_attended and classes_held
    csv_content = """semester,subject,recorded_on
QA_Sandbox_2026,Software Testing,2026-04-25
"""
    file = {"file": ("data.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    resp = client.post(
        "/import/csv",
        headers=headers,
        data={"import_type": "attendance", "dry_run": True},
        files=file
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert data["total_processed"] == 0
    assert data["imported_records"] == 0
    assert len(data["errors"]) == 1
    assert data["errors"][0]["row"] == 1
    assert data["errors"][0]["column"] == "classes_attended, classes_held"
    assert "Missing required header(s): classes_attended, classes_held" in data["errors"][0]["message"]

    sems = client.get("/semesters", headers=headers).json()
    assert len(sems) == 0

def test_import_empty_or_headerless_csv(db_session):
    token, user_id = get_token_for_user(db_session, "import_empty@example.com", "Import Empty")
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Completely empty
    file = {"file": ("data.csv", io.BytesIO(b""), "text/csv")}
    resp = client.post(
        "/import/csv",
        headers=headers,
        data={"import_type": "attendance", "dry_run": True},
        files=file
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert data["total_processed"] == 0
    assert data["errors"][0]["row"] == 1
    assert "classes_held" in data["errors"][0]["column"]

    # 2. Whitespace only
    file = {"file": ("data.csv", io.BytesIO(b"   \n  \n  "), "text/csv")}
    resp = client.post(
        "/import/csv",
        headers=headers,
        data={"import_type": "academic", "dry_run": True},
        files=file
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert data["total_processed"] == 0
    assert data["errors"][0]["row"] == 1
    assert "semester" in data["errors"][0]["column"]

    sems = client.get("/semesters", headers=headers).json()
    assert len(sems) == 0

def test_import_attendance_missing_row_value_does_not_default_to_zero(db_session):
    token, user_id = get_token_for_user(db_session, "import_missing_cell@example.com", "Import Missing Cell")
    headers = {"Authorization": f"Bearer {token}"}

    # Valid headers, but classes_attended is empty string in the data row
    csv_content = """semester,subject,classes_attended,classes_held,recorded_on
Sem 1,Physics,,10,2026-10-01
"""
    file = {"file": ("data.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    resp = client.post(
        "/import/csv",
        headers=headers,
        data={"import_type": "attendance", "dry_run": False},
        files=file
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert data["imported_records"] == 0
    assert len(data["errors"]) == 1
    assert data["errors"][0]["row"] == 2
    assert "classes_attended and classes_held are required" in data["errors"][0]["message"]

    sems = client.get("/semesters", headers=headers).json()
    assert len(sems) == 0
