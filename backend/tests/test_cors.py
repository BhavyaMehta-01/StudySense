from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_cors_preflight_register_localhost():
    headers = {
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    }
    response = client.options("/auth/register", headers=headers)
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "POST" in response.headers.get("access-control-allow-methods", "")
    assert "content-type" in response.headers.get("access-control-allow-headers", "").lower()
    # Confirm credentials are not allowed
    assert response.headers.get("access-control-allow-credentials") != "true"

def test_cors_preflight_register_127_origin():
    headers = {
        "Origin": "http://127.0.0.1:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    }
    response = client.options("/auth/register", headers=headers)
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://127.0.0.1:5173"

def test_cors_preflight_unauthorized_origin_rejected():
    headers = {
        "Origin": "http://unauthorized-domain.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    }
    response = client.options("/auth/register", headers=headers)
    assert "access-control-allow-origin" not in response.headers

def test_cors_preflight_authorization_header():
    headers = {
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
    }
    response = client.options("/auth/me", headers=headers)
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "authorization" in response.headers.get("access-control-allow-headers", "").lower()

def test_cors_get_health_from_allowed_origin():
    response = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
