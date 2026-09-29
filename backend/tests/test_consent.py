import pytest
from fastapi.testclient import TestClient
from app.main import app
from tests.test_academic_crud import get_token_for_user, setup_database, db_session

client = TestClient(app)

def test_consent_default_and_opt_in(db_session):
    token, user_id = get_token_for_user(db_session, "consent1@example.com", "Consent 1")
    headers = {"Authorization": f"Bearer {token}"}
    
    # Check default is False
    resp = client.get("/consent", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["data_donation_consent"] is False
    assert resp.json()["consent_updated_at"] is None
    
    # Opt in
    resp = client.put("/consent", json={"data_donation_consent": True, "consent_text_version": "v1.0"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["data_donation_consent"] is True
    assert resp.json()["consent_updated_at"] is not None
    assert resp.json()["consent_text_version"] == "v1.0"
    
    # Revoke
    resp = client.put("/consent", json={"data_donation_consent": False, "consent_text_version": "v1.0"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["data_donation_consent"] is False
