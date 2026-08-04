"""
Router tests for /api/favorites — per-user pinned streams. The interesting
behavior is the per-user scoping: two different users' favorites must
never leak into each other's list.
"""

from __future__ import annotations

from backend.models import UserRole


def test_list_requires_auth(client):
    resp = client.get("/api/favorites")
    assert resp.status_code == 401


def test_list_is_empty_for_a_fresh_user(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.get("/api/favorites", headers=auth)

    assert resp.status_code == 200
    assert resp.json() == []


def test_add_and_list_a_favorite(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    add_resp = client.post("/api/favorites", headers=auth, json={"stream_path": "cam1"})
    assert add_resp.status_code == 201

    resp = client.get("/api/favorites", headers=auth)
    assert resp.json() == ["cam1"]


def test_adding_the_same_favorite_twice_is_not_an_error_and_does_not_duplicate(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    client.post("/api/favorites", headers=auth, json={"stream_path": "cam1"})
    resp = client.post("/api/favorites", headers=auth, json={"stream_path": "cam1"})

    assert resp.status_code == 201
    assert client.get("/api/favorites", headers=auth).json() == ["cam1"]


def test_remove_a_favorite(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")
    client.post("/api/favorites", headers=auth, json={"stream_path": "cam1"})

    resp = client.delete("/api/favorites/cam1", headers=auth)

    assert resp.status_code == 200
    assert client.get("/api/favorites", headers=auth).json() == []


def test_removing_a_favorite_that_was_never_added_is_404(client, auth_headers):
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.delete("/api/favorites/never-added", headers=auth)

    assert resp.status_code == 404


def test_favorites_are_scoped_per_user_not_shared(client, auth_headers):
    alice_auth, _ = auth_headers(UserRole.viewer, username="alice")
    bob_auth, _ = auth_headers(UserRole.viewer, username="bob")

    client.post("/api/favorites", headers=alice_auth, json={"stream_path": "cam1"})
    client.post("/api/favorites", headers=bob_auth, json={"stream_path": "cam2"})

    assert client.get("/api/favorites", headers=alice_auth).json() == ["cam1"]
    assert client.get("/api/favorites", headers=bob_auth).json() == ["cam2"]


def test_a_viewer_can_manage_their_own_favorites_without_admin(client, auth_headers):
    """Favorites are a personal preference, not an admin-gated action —
    unlike users/routes/alert-rules, every role can use this."""
    auth, _ = auth_headers(UserRole.viewer, username="viewer1")

    resp = client.post("/api/favorites", headers=auth, json={"stream_path": "cam1"})

    assert resp.status_code == 201
