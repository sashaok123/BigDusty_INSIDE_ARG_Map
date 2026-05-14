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


async def test_invitation_create_and_setup(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    create = await client.post(
        "/admin/invitations",
        json={"username": "teammate", "is_admin": False},
        headers=headers,
    )
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["token"]
    assert body["setup_url"].endswith(f"invite={body['token']}")
    assert body["username"] == "teammate"
    assert body["is_admin_initial"] is False

    check = await client.get(f"/auth/invitation/{body['token']}")
    assert check.status_code == 200
    assert check.json()["valid"] is True
    assert check.json()["username"] == "teammate"

    setup = await client.post(
        "/auth/setup",
        json={"token": body["token"], "password": "fresh-pw-12345"},
    )
    assert setup.status_code == 200, setup.text
    pair = setup.json()
    assert pair["access_token"]
    assert pair["user"]["username"] == "teammate"

    again = await client.post(
        "/auth/setup",
        json={"token": body["token"], "password": "fresh-pw-12345"},
    )
    assert again.status_code == 410


async def test_invitation_duplicate_pending_rejected(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    first = await client.post(
        "/admin/invitations",
        json={"username": "dup-user", "is_admin": False},
        headers=headers,
    )
    assert first.status_code == 201, first.text
    second = await client.post(
        "/admin/invitations",
        json={"username": "dup-user", "is_admin": False},
        headers=headers,
    )
    assert second.status_code == 409


async def test_invitation_list_and_revoke(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    created = await client.post(
        "/admin/invitations",
        json={"username": "to-revoke", "is_admin": False},
        headers=headers,
    )
    assert created.status_code == 201
    inv_id = created.json()["id"]
    listed = await client.get("/admin/invitations", headers=headers)
    assert listed.status_code == 200
    ids = [row["id"] for row in listed.json()]
    assert inv_id in ids
    revoke = await client.delete(f"/admin/invitations/{inv_id}", headers=headers)
    assert revoke.status_code == 204


async def test_invitation_invalid_token(client):
    check = await client.get("/auth/invitation/does-not-exist-token")
    assert check.status_code == 404


_TINY_PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR"
    b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\xf0\x1f\x00\x00\x06\x00\x03"
    b"\xfd\xd9\xa6\x9d"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


async def test_image_upload_and_fetch(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    files = {"file": ("tiny.png", _TINY_PNG, "image/png")}
    resp = await client.post("/canvas/main/images", files=files, headers=headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["id"]
    assert body["sha256"]
    assert body["mime"] == "image/png"
    assert body["size"] == len(_TINY_PNG)
    assert body["url"].endswith(body["id"])
    assert "/canvas/main/images/" in body["url"]

    fetched = await client.get(body["url"])
    assert fetched.status_code == 200
    assert fetched.content == _TINY_PNG
    assert fetched.headers["content-type"].startswith("image/png")
    cache_ctrl = fetched.headers.get("cache-control", "")
    assert "immutable" in cache_ctrl
    assert "max-age" in cache_ctrl


async def test_image_upload_dedupe(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    files1 = {"file": ("a.png", _TINY_PNG, "image/png")}
    first = await client.post("/canvas/main/images", files=files1, headers=headers)
    assert first.status_code == 201, first.text
    first_body = first.json()

    files2 = {"file": ("b.png", _TINY_PNG, "image/png")}
    second = await client.post("/canvas/main/images", files=files2, headers=headers)
    assert second.status_code == 201, second.text
    second_body = second.json()
    assert second_body["id"] == first_body["id"]
    assert second_body["sha256"] == first_body["sha256"]


async def test_image_upload_requires_auth(client):
    files = {"file": ("anon.png", _TINY_PNG, "image/png")}
    resp = await client.post("/canvas/main/images", files=files)
    assert resp.status_code == 401


async def test_audit_log_records_login_and_image_upload(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    files = {"file": ("audit.png", _TINY_PNG, "image/png")}
    upload = await client.post("/canvas/main/images", files=files, headers=headers)
    assert upload.status_code == 201

    audit = await client.get("/admin/audit", headers=headers)
    assert audit.status_code == 200, audit.text
    rows = audit.json()
    assert isinstance(rows, list)
    actions = {r["action"] for r in rows}
    assert "login" in actions
    assert "image_uploaded" in actions


async def test_audit_log_requires_admin(client):
    resp = await client.get("/admin/audit")
    assert resp.status_code == 401


async def test_audit_log_records_canvas_replace(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    base = await client.get("/canvas/main")
    rev0 = base.json()["revision"]
    body = {
        "data": {"nodes": [{"id": "node_audit", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "text": "x"}], "edges": []},
        "expected_revision": rev0,
    }
    resp = await client.put("/canvas/main", json=body, headers=headers)
    assert resp.status_code == 200
    audit = await client.get("/admin/audit", headers=headers)
    assert audit.status_code == 200
    actions = [r["action"] for r in audit.json()]
    assert "canvas_replaced" in actions


async def test_node_translations_persist(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    create = await client.post(
        "/canvas/main/nodes",
        json={
            "id": "node_translate",
            "type": "text",
            "x": 0, "y": 0, "width": 100, "height": 50,
            "text": "Hello in English",
            "translations": {
                "ru": {"label": "Привет", "body": "Текст по-русски"},
                "de": {"label": "Hallo", "body": "Deutscher Text"},
            },
        },
        headers=headers,
    )
    assert create.status_code == 201, create.text
    snap = await client.get("/canvas/main")
    node = next(n for n in snap.json()["data"]["nodes"] if n["id"] == "node_translate")
    assert node["translations"]["ru"]["label"] == "Привет"
    assert node["translations"]["de"]["body"] == "Deutscher Text"

    patch = await client.patch(
        "/canvas/main/nodes/node_translate",
        json={"translations": {"ru": {"label": "Здравствуй"}, "it": {"label": "Ciao"}}},
        headers=headers,
    )
    assert patch.status_code == 200
    snap2 = await client.get("/canvas/main")
    node2 = next(n for n in snap2.json()["data"]["nodes"] if n["id"] == "node_translate")
    assert node2["translations"]["ru"]["label"] == "Здравствуй"
    assert node2["translations"]["it"]["label"] == "Ciao"
