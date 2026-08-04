"""
Router tests for /api/users — admin-only CRUD plus the self-service /me
and self-protection guards (can't demote/deactivate/delete yourself).
"""

from __future__ import annotations

from backend.models import UserRole


def test_list_users_requires_admin(client, auth_headers):
    headers, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/users", headers=headers)

    assert resp.status_code == 403


def test_list_users_as_admin(client, auth_headers, make_user):
    headers, _ = auth_headers(UserRole.admin, username="admin1")
    make_user(username="op1", role=UserRole.operator)

    resp = client.get("/api/users", headers=headers)

    assert resp.status_code == 200
    usernames = {u["username"] for u in resp.json()}
    assert {"admin1", "op1"} <= usernames


def test_list_users_filters_by_role(client, auth_headers, make_user):
    headers, _ = auth_headers(UserRole.admin, username="admin1")
    make_user(username="op1", role=UserRole.operator)
    make_user(username="viewer1", role=UserRole.viewer)

    resp = client.get("/api/users", params={"role": "operator"}, headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert all(u["role"] == "operator" for u in body)
    assert any(u["username"] == "op1" for u in body)


def test_create_user_requires_admin(client, auth_headers):
    headers, _ = auth_headers(UserRole.operator, username="op1")

    resp = client.post(
        "/api/users",
        headers=headers,
        json={"username": "x", "email": "x@example.com", "password": "Password123!", "role": "viewer"},
    )

    assert resp.status_code == 403


def test_get_own_profile_by_id(client, auth_headers):
    headers, user = auth_headers(UserRole.viewer, username="selfview")

    resp = client.get(f"/api/users/{user.id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["username"] == "selfview"


def test_get_other_users_profile_forbidden_for_non_admin(client, auth_headers, make_user):
    headers, _ = auth_headers(UserRole.viewer, username="viewer1")
    other = make_user(username="viewer2", role=UserRole.viewer)

    resp = client.get(f"/api/users/{other.id}", headers=headers)

    assert resp.status_code == 403


def test_get_any_users_profile_allowed_for_admin(client, auth_headers, make_user):
    headers, _ = auth_headers(UserRole.admin, username="admin1")
    other = make_user(username="viewer1", role=UserRole.viewer)

    resp = client.get(f"/api/users/{other.id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["username"] == "viewer1"


def test_get_nonexistent_user_is_404(client, auth_headers):
    headers, _ = auth_headers(UserRole.admin, username="admin1")

    resp = client.get("/api/users/999999", headers=headers)

    assert resp.status_code == 404


def test_admin_can_update_another_users_role(client, auth_headers, make_user):
    headers, _ = auth_headers(UserRole.admin, username="admin1")
    target = make_user(username="viewer1", role=UserRole.viewer)

    resp = client.put(
        f"/api/users/{target.id}",
        headers=headers,
        json={"role": "operator"},
    )

    assert resp.status_code == 200
    assert resp.json()["role"] == "operator"


def test_updating_a_user_writes_an_audit_entry(client, auth_headers, make_user):
    headers, _ = auth_headers(UserRole.admin, username="admin1")
    target = make_user(username="viewer1", role=UserRole.viewer)

    client.put(f"/api/users/{target.id}", headers=headers, json={"role": "operator", "is_active": False})

    log = client.get("/api/audit", headers=headers).json()
    entry = next(e for e in log if e["action"] == "user.update")
    assert entry["username"] == "admin1"
    assert entry["target"] == "viewer1"
    assert "role" in entry["detail"]
    assert "is_active" in entry["detail"]


def test_admin_cannot_demote_own_account(client, auth_headers):
    headers, admin = auth_headers(UserRole.admin, username="admin1")

    resp = client.put(
        f"/api/users/{admin.id}",
        headers=headers,
        json={"role": "viewer"},
    )

    assert resp.status_code == 403


def test_admin_cannot_deactivate_own_account(client, auth_headers):
    headers, admin = auth_headers(UserRole.admin, username="admin1")

    resp = client.put(
        f"/api/users/{admin.id}",
        headers=headers,
        json={"is_active": False},
    )

    assert resp.status_code == 403


def test_update_email_conflict_is_409(client, auth_headers, make_user):
    headers, _ = auth_headers(UserRole.admin, username="admin1")
    make_user(username="viewer1", role=UserRole.viewer, email="taken@example.com")
    target = make_user(username="viewer2", role=UserRole.viewer)

    resp = client.put(
        f"/api/users/{target.id}",
        headers=headers,
        json={"email": "taken@example.com"},
    )

    assert resp.status_code == 409


def test_admin_cannot_delete_own_account(client, auth_headers):
    headers, admin = auth_headers(UserRole.admin, username="admin1")

    resp = client.delete(f"/api/users/{admin.id}", headers=headers)

    assert resp.status_code == 403


# Note: the "only remaining admin" 409 guard in delete_user is unreachable
# through the API as currently guarded. You can never target yourself (that
# hits the separate self-delete 403 above), and reaching this endpoint at
# all requires the *caller* to be an admin — so any other admin you delete
# always leaves at least the caller behind, meaning admin_count is >= 2
# whenever the check runs. The safety property it wants (never end up with
# zero admins) already holds via the self-delete guard; this branch is dead
# code, not a hole — no test for the 409 path since there's no way to hit it.


def test_admin_can_delete_another_user_when_not_the_last_admin(client, auth_headers, make_user):
    headers, _ = auth_headers(UserRole.admin, username="admin1")
    make_user(username="admin2", role=UserRole.admin)  # keeps admin count at 2
    target = make_user(username="viewer1", role=UserRole.viewer)

    resp = client.delete(f"/api/users/{target.id}", headers=headers)

    assert resp.status_code == 200

    follow_up = client.get(f"/api/users/{target.id}", headers=headers)
    assert follow_up.status_code == 404
