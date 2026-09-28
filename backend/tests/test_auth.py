import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timedelta, timezone
import jwt
from sqlalchemy.orm import Session

from app.main import app
from app.config import settings
from app.database import engine, Base, SessionLocal
from app.models import User
from app.auth import get_password_hash

client = TestClient(app)

@pytest.fixture(scope="module")
def setup_database():
    Base.metadata.create_all(bind=engine)
    yield

@pytest.fixture
def db_session(setup_database):
    connection = engine.connect()
    transaction = connection.begin()
    session = SessionLocal(bind=connection)
    
    # We yield the session but also need to override the dependency in FastAPI
    def override_get_db():
        yield session
        
    app.dependency_overrides[SessionLocal] = override_get_db # Actually, the dependency uses `app.dependencies.get_db`
    # Let's override properly:
    from app.dependencies import get_db
    app.dependency_overrides[get_db] = override_get_db
    
    yield session
    
    app.dependency_overrides.clear()
    session.close()
    transaction.rollback()
    connection.close()

def test_successful_registration(db_session):
    response = client.post(
        "/auth/register",
        json={"email": "register@example.com", "password": "securepassword", "name": "Test User"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "register@example.com"
    assert data["name"] == "Test User"
    assert "password" not in data
    assert "password_hash" not in data

def test_duplicate_email_registration(db_session):
    client.post(
        "/auth/register",
        json={"email": "duplicate@example.com", "password": "securepassword", "name": "User 1"}
    )
    response = client.post(
        "/auth/register",
        json={"email": "DUPLICATE@example.com", "password": "otherpassword", "name": "User 2"}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Email already registered"

def test_password_is_hashed(db_session):
    client.post(
        "/auth/register",
        json={"email": "hashed@example.com", "password": "mypassword", "name": "Hashed User"}
    )
    user = db_session.query(User).filter(User.email == "hashed@example.com").first()
    assert user is not None
    assert user.password_hash != "mypassword"
    assert "argon2" in user.password_hash

def test_successful_login(db_session):
    client.post(
        "/auth/register",
        json={"email": "login@example.com", "password": "loginpassword", "name": "Login User"}
    )
    response = client.post(
        "/auth/login",
        json={"email": "login@example.com", "password": "loginpassword"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert "user" in data
    assert "password" not in data["user"]
    assert "password_hash" not in data["user"]

def test_wrong_password(db_session):
    client.post(
        "/auth/register",
        json={"email": "wrongpass@example.com", "password": "correctpassword", "name": "Wrong Pass User"}
    )
    response = client.post(
        "/auth/login",
        json={"email": "wrongpass@example.com", "password": "incorrectpassword"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect email or password"

def test_unknown_email(db_session):
    response = client.post(
        "/auth/login",
        json={"email": "unknown@example.com", "password": "anypassword"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect email or password"

def test_valid_jwt_allows_me(db_session):
    client.post(
        "/auth/register",
        json={"email": "me@example.com", "password": "password", "name": "Me User"}
    )
    login_response = client.post(
        "/auth/login",
        json={"email": "me@example.com", "password": "password"}
    )
    token = login_response.json()["access_token"]
    
    response = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "me@example.com"

def test_missing_jwt_rejected(db_session):
    response = client.get("/auth/me")
    assert response.status_code == 403 # HTTPBearer returns 403 when missing

def test_invalid_jwt_rejected(db_session):
    response = client.get(
        "/auth/me",
        headers={"Authorization": "Bearer invalid.token.string"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Could not validate credentials"

def test_expired_jwt_rejected(db_session):
    # Create user directly to avoid token creation during login
    user = User(email="expired@example.com", password_hash="hash", name="Expired User")
    db_session.add(user)
    db_session.flush()
    
    # Create an expired token manually
    expire = datetime.now(timezone.utc) - timedelta(minutes=1)
    to_encode = {"sub": str(user.id), "exp": expire}
    token = jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    
    response = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 401

def test_user_a_cannot_auth_as_user_b(db_session):
    client.post("/auth/register", json={"email": "a@example.com", "password": "pass", "name": "A"})
    client.post("/auth/register", json={"email": "b@example.com", "password": "pass", "name": "B"})
    
    login_a = client.post("/auth/login", json={"email": "a@example.com", "password": "pass"})
    token_a = login_a.json()["access_token"]
    
    # User A tries to fetch /me
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token_a}"})
    assert response.status_code == 200
    assert response.json()["email"] == "a@example.com"
    # Token A gives User A's identity, there's no way to pass a parameter to get User B.
