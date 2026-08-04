"""
Router tests for /api/auth — the OAuth2 token endpoint, registration, and
/me. This is the trust boundary every other router depends on (require_admin
/ get_current_active_user), so it gets the most direct coverage.
"""

from __future__ import annotations

from backend.models import UserRole


def test_login_with_correct_credentials_returns_token(client, make_user):
    make_user(username="alice", password="Password123!", role=UserRole.viewer)

    resp = client.post(
        "/api/auth/token",
        data={"username": "alice", "password": "Password123!"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"]
    assert body["token_type"] == "bearer"


def test_successful_login_records_last_login(client, make_user, auth_headers):
    make_user(username="alice", password="Password123!", role=UserRole.viewer)
    admin_auth, _ = auth_headers(UserRole.admin, username="admin1")

    before = client.get("/api/users", headers=admin_auth).json()
    assert next(u for u in before if u["username"] == "alice")["last_login"] is None

    client.post("/api/auth/token", data={"username": "alice", "password": "Password123!"})

    after = client.get("/api/users", headers=admin_auth).json()
    assert next(u for u in after if u["username"] == "alice")["last_login"] is not None


def test_failed_login_does_not_record_last_login(client, make_user, auth_headers):
    make_user(username="alice", password="Password123!", role=UserRole.viewer)
    admin_auth, _ = auth_headers(UserRole.admin, username="admin1")

    client.post("/api/auth/token", data={"username": "alice", "password": "wrong-password"})

    users = client.get("/api/users", headers=admin_auth).json()
    assert next(u for u in users if u["username"] == "alice")["last_login"] is None


def test_login_with_wrong_password_is_401(client, make_user):
    make_user(username="alice", password="Password123!", role=UserRole.viewer)

    resp = client.post(
        "/api/auth/token",
        data={"username": "alice", "password": "wrong-password"},
    )

    assert resp.status_code == 401


def test_login_with_unknown_username_is_401(client):
    resp = client.post(
        "/api/auth/token",
        data={"username": "nobody", "password": "whatever"},
    )

    assert resp.status_code == 401


def test_login_with_disabled_account_is_403(client, make_user):
    make_user(username="disabled-user", password="Password123!", role=UserRole.viewer, is_active=False)

    resp = client.post(
        "/api/auth/token",
        data={"username": "disabled-user", "password": "Password123!"},
    )

    assert resp.status_code == 403


def test_sixth_failed_attempt_is_locked_out(client, make_user):
    make_user(username="bob", password="Password123!", role=UserRole.viewer)

    for _ in range(5):
        resp = client.post(
            "/api/auth/token",
            data={"username": "bob", "password": "wrong"},
        )
        assert resp.status_code == 401

    resp = client.post(
        "/api/auth/token",
        data={"username": "bob", "password": "wrong"},
    )
    assert resp.status_code == 429

    # Even the CORRECT password is rejected while locked out.
    resp = client.post(
        "/api/auth/token",
        data={"username": "bob", "password": "Password123!"},
    )
    assert resp.status_code == 429


def test_me_requires_authentication(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_me_returns_current_user_profile(client, auth_headers):
    headers, user = auth_headers(UserRole.viewer, username="carol")

    resp = client.get("/api/auth/me", headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["username"] == "carol"
    assert body["role"] == "viewer"


def test_me_rejects_garbage_token(client):
    resp = client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert resp.status_code == 401


def test_register_requires_admin(client, auth_headers):
    headers, _ = auth_headers(UserRole.viewer, username="dave")

    resp = client.post(
        "/api/auth/register",
        headers=headers,
        json={
            "username": "newuser",
            "email": "newuser@example.com",
            "password": "Password123!",
            "role": "viewer",
        },
    )

    assert resp.status_code == 403


def test_register_as_admin_creates_user(client, auth_headers):
    headers, _ = auth_headers(UserRole.admin, username="admin-user")

    resp = client.post(
        "/api/auth/register",
        headers=headers,
        json={
            "username": "newuser",
            "email": "newuser@example.com",
            "password": "Password123!",
            "role": "operator",
        },
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["username"] == "newuser"
    assert body["role"] == "operator"
    assert "password" not in body
    assert "hashed_password" not in body


def test_register_accepts_internal_local_domain_email(client, auth_headers):
    """Regression test: EmailStr (pydantic's deliverability-aware email
    type) used to reject .local as a reserved special-use TLD, which
    meant an admin could never register a user with an internal address
    like the seeded default admin's own admin@arena.local — confirmed
    live via a 422 before models.py switched to a plain shape-only regex
    (EMAIL_PATTERN). Nothing in this app ever sends mail to this field,
    so deliverability was never a real constraint here."""
    headers, _ = auth_headers(UserRole.admin, username="admin-user")

    resp = client.post(
        "/api/auth/register",
        headers=headers,
        json={
            "username": "internaluser",
            "email": "internaluser@arena.local",
            "password": "Password123!",
            "role": "viewer",
        },
    )

    assert resp.status_code == 201


def test_register_rejects_malformed_email(client, auth_headers):
    headers, _ = auth_headers(UserRole.admin, username="admin-user")

    resp = client.post(
        "/api/auth/register",
        headers=headers,
        json={
            "username": "baduser",
            "email": "not-an-email",
            "password": "Password123!",
            "role": "viewer",
        },
    )

    assert resp.status_code == 422


def test_register_duplicate_username_is_409(client, auth_headers, make_user):
    headers, _ = auth_headers(UserRole.admin, username="admin-user")
    make_user(username="taken", password="Password123!", role=UserRole.viewer)

    resp = client.post(
        "/api/auth/register",
        headers=headers,
        json={
            "username": "taken",
            "email": "someone-else@example.com",
            "password": "Password123!",
            "role": "viewer",
        },
    )

    assert resp.status_code == 409


def test_register_rejects_weak_password(client, auth_headers):
    headers, _ = auth_headers(UserRole.admin, username="admin-user")

    resp = client.post(
        "/api/auth/register",
        headers=headers,
        json={
            "username": "weakpw",
            "email": "weakpw@example.com",
            "password": "123",
            "role": "viewer",
        },
    )

    assert resp.status_code in (400, 422)
