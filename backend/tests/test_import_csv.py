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
    assert data["success"] is False # dry_run rolls back, so technically not "successful import" but it returns 0 errors
    assert len(data["errors"]) == 0
    assert data["total_processed"] == 2
    
    # Ensure not actually saved
    sems = client.get("/semesters", headers=headers).json()
    assert len(sems) == 0
    
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
    
def test_import_academic_validation_errors(db_session):
    token, user_id = get_token_for_user(db_session, "import2@example.com", "Import 2")
    headers = {"Authorization": f"Bearer {token}"}
    
    csv_content = """semester,subject,assessment,category,status,max_marks,marks,weightage
Sem 1,Math,Midterm,invalid_cat,scored,100,80,40
Sem 1,Math,Final,endsem,pending,100,,101
Sem 1,Math,Test1,quiz,scored,100,105,10
"""
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
    assert len(data["errors"]) == 3
    
    # 101 weightage -> over 100
    # 105 marks -> marks > max_marks
    # invalid_cat
    errors = [e["message"] for e in data["errors"]]
    assert any("Invalid category" in e for e in errors)
    assert any("Invalid weightage" in e for e in errors)
    assert any("Invalid marks" in e for e in errors)

def test_import_attendance(db_session):
    token, user_id = get_token_for_user(db_session, "import3@example.com", "Import 3")
    headers = {"Authorization": f"Bearer {token}"}
    
    csv_content = """semester,subject,classes_attended,classes_held,recorded_on
Sem 1,Physics,8,10,2026-10-01
"""
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
