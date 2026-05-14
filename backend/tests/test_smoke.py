"""Smoke tests: app boots, auth works, canvas CRUD respects revisions."""

import pytest

pytestmark = pytest.mark.asyncio


async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_login_seeded_admin(client):
    resp = await client.post(
        "/auth/login",
        json={"username": "admin", "password": "smoke-test-password-123"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["user"]["username"] == "admin"
    assert body["user"]["is_admin"] is True


async def test_get_canvas_no_auth(client):
    resp = await client.get("/canvas/main")
    assert resp.status_code == 200
    body = resp.json()
    assert "revision" in body
    assert "data" in body
    assert isinstance(body["data"].get("nodes"), list)


async def test_put_canvas_requires_auth(client):
    resp = await client.put(
        "/canvas/main",
        json={"data": {"nodes": [], "edges": []}, "expected_revision": 1},
    )
    assert resp.status_code == 401


async def test_put_canvas_bumps_revision(client, admin_token):
    base = await client.get("/canvas/main")
    rev0 = base.json()["revision"]
    headers = {"Authorization": f"Bearer {admin_token}"}
    body = {
        "data": {"nodes": [{"id": "node_test", "type": "text", "x": 0, "y": 0, "width": 100, "height": 50, "text": "hi"}], "edges": []},
        "expected_revision": rev0,
    }
    resp = await client.put("/canvas/main", json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    after = resp.json()
    assert after["revision"] == rev0 + 1
    assert any(n["id"] == "node_test" for n in after["data"]["nodes"])


async def test_put_canvas_revision_conflict(client, admin_token):
    base = await client.get("/canvas/main")
    rev0 = base.json()["revision"]
    headers = {"Authorization": f"Bearer {admin_token}"}
    body = {"data": {"nodes": [], "edges": []}, "expected_revision": rev0 + 999}
    resp = await client.put("/canvas/main", json=body, headers=headers)
    assert resp.status_code == 409


async def test_node_crud_cycle(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    create = await client.post(
        "/canvas/main/nodes",
        json={"id": "node_crud", "type": "text", "x": 1, "y": 2, "width": 10, "height": 10, "text": "a"},
        headers=headers,
    )
    assert create.status_code == 201, create.text
    rev_after_create = create.json()["revision"]

    patch = await client.patch(
        "/canvas/main/nodes/node_crud",
        json={"text": "b"},
        headers=headers,
    )
    assert patch.status_code == 200
    assert patch.json()["revision"] == rev_after_create + 1

    snap = await client.get("/canvas/main")
    node = next(n for n in snap.json()["data"]["nodes"] if n["id"] == "node_crud")
    assert node["text"] == "b"

    delete = await client.delete("/canvas/main/nodes/node_crud", headers=headers)
    assert delete.status_code == 200


async def test_refresh_and_me(client):
    login = await client.post(
        "/auth/login",
        json={"username": "admin", "password": "smoke-test-password-123"},
    )
    tokens = login.json()
    refresh = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refresh.status_code == 200, refresh.text
    new_access = refresh.json()["access_token"]
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {new_access}"})
    assert me.status_code == 200
    assert me.json()["username"] == "admin"
