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


async def test_node_mutation_broadcasts_client_id(client, admin_token):
    from app.ws import manager

    received: list[dict] = []

    class _Sink:
        async def send_json(self, msg: dict) -> None:
            received.append(msg)

    sink = _Sink()
    async with manager._lock:
        manager._rooms.setdefault("main", set()).add(sink)

    try:
        headers = {"Authorization": f"Bearer {admin_token}", "X-Client-Id": "echo-test-client"}
        create = await client.post(
            "/canvas/main/nodes",
            json={"id": "node_echo", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "text": "echo"},
            headers=headers,
        )
        assert create.status_code == 201, create.text
    finally:
        async with manager._lock:
            room = manager._rooms.get("main")
            if room is not None:
                room.discard(sink)

    assert received, "expected at least one broadcast"
    matching = [m for m in received if m.get("change", {}).get("id") == "node_echo"]
    assert matching, f"expected a broadcast for node_echo, got {received}"
    assert matching[-1]["change"].get("clientId") == "echo-test-client"


async def test_edge_label_object_round_trip(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}", "X-Client-Id": "edge-label-test"}
    rev0 = (await client.get("/canvas/main")).json()["revision"]
    body = {
        "data": {
            "nodes": [
                {"id": "blk_a", "type": "file", "x": 0, "y": 0, "width": 100, "height": 100, "file": "a.webp", "kind": "block"},
                {"id": "blk_b", "type": "file", "x": 200, "y": 0, "width": 100, "height": 100, "file": "b.webp", "kind": "block"},
            ],
            "edges": [
                {
                    "id": "edge_label_obj",
                    "fromNode": "blk_a",
                    "toNode": "blk_b",
                    "routing": "orthogonal",
                    "style": "solid",
                    "label": {"text": "free label", "position": {"x": 150, "y": 250}},
                }
            ],
        },
        "expected_revision": rev0,
    }
    put_resp = await client.put("/canvas/main", json=body, headers=headers)
    assert put_resp.status_code == 200, put_resp.text
    snap = await client.get("/canvas/main")
    edge = next(e for e in snap.json()["data"]["edges"] if e["id"] == "edge_label_obj")
    assert isinstance(edge["label"], dict)
    assert edge["label"]["text"] == "free label"
    assert edge["label"]["position"]["x"] == 150
    assert edge["label"]["position"]["y"] == 250

    rev1 = snap.json()["revision"]
    patch_resp = await client.patch(
        "/canvas/main/edges/edge_label_obj",
        json={"label": {"text": "moved", "position": None}},
        headers=headers,
    )
    assert patch_resp.status_code == 200, patch_resp.text
    snap2 = await client.get("/canvas/main")
    edge2 = next(e for e in snap2.json()["data"]["edges"] if e["id"] == "edge_label_obj")
    assert isinstance(edge2["label"], dict)
    assert edge2["label"]["text"] == "moved"
    assert edge2["label"]["position"] is None
    assert snap2.json()["revision"] == rev1 + 1


_TINY_WEBM = (
    b"\x1a\x45\xdf\xa3"
    b"\x9f\x42\x86\x81\x01"
    b"\x42\xf7\x81\x01"
    b"\x42\xf2\x81\x04"
    b"\x42\xf3\x81\x08"
    b"\x42\x82\x84webm"
    b"\x42\x87\x81\x02"
    b"\x42\x85\x81\x02"
)


async def test_video_upload_accepted(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    files = {"file": ("clip.webm", _TINY_WEBM, "video/webm")}
    resp = await client.post("/canvas/main/images", files=files, headers=headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["mime"] == "video/webm"
    assert body["size"] == len(_TINY_WEBM)
    fetched = await client.get(body["url"])
    assert fetched.status_code == 200
    assert fetched.headers["content-type"].startswith("video/webm")
    audit = await client.get("/admin/audit", headers=headers)
    actions = [r["action"] for r in audit.json()]
    assert "video_uploaded" in actions


async def test_video_upload_rejects_unsupported(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    files = {"file": ("clip.avi", b"\x00" * 16, "video/x-msvideo")}
    resp = await client.post("/canvas/main/images", files=files, headers=headers)
    assert resp.status_code == 415


async def test_comments_create_list_reply(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    create = await client.post(
        "/canvas/main/comments",
        json={"x": 100.5, "y": 50.25, "body": "Look at this corner"},
        headers=headers,
    )
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["id"]
    assert body["x"] == 100.5
    assert body["y"] == 50.25
    assert isinstance(body["thread"], list)
    assert body["thread"][0]["body"] == "Look at this corner"

    reply = await client.post(
        f"/canvas/main/comments/{body['id']}/reply",
        json={"body": "I see it too"},
        headers=headers,
    )
    assert reply.status_code == 200, reply.text
    assert len(reply.json()["thread"]) == 2

    listed = await client.get("/canvas/main/comments")
    assert listed.status_code == 200
    rows = listed.json()
    ids = [r["id"] for r in rows]
    assert body["id"] in ids


async def test_comments_anonymous_can_read_not_write(client):
    listed = await client.get("/canvas/main/comments")
    assert listed.status_code == 200
    rejected = await client.post(
        "/canvas/main/comments",
        json={"x": 1.0, "y": 1.0, "body": "anon"},
    )
    assert rejected.status_code == 401


async def test_node_text_style_round_trip(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    create = await client.post(
        "/canvas/main/nodes",
        json={
            "id": "node_textstyle",
            "type": "text",
            "x": 0, "y": 0, "width": 200, "height": 60,
            "text": "Hello",
            "kind": "text",
            "text_style": {"size": "L", "family": "mono", "color": "auto", "align": "center"},
        },
        headers=headers,
    )
    assert create.status_code == 201, create.text
    snap = await client.get("/canvas/main")
    node = next(n for n in snap.json()["data"]["nodes"] if n["id"] == "node_textstyle")
    assert node["text_style"]["size"] == "L"
    assert node["text_style"]["family"] == "mono"


async def test_video_node_round_trip(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    create = await client.post(
        "/canvas/main/nodes",
        json={
            "id": "node_video",
            "type": "link",
            "x": 0, "y": 0, "width": 560, "height": 320,
            "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "kind": "video",
            "media": {
                "kind": "youtube",
                "provider": "youtube",
                "videoId": "dQw4w9WgXcQ",
                "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "embedUrl": "https://www.youtube.com/embed/dQw4w9WgXcQ",
            },
        },
        headers=headers,
    )
    assert create.status_code == 201, create.text
    snap = await client.get("/canvas/main")
    node = next(n for n in snap.json()["data"]["nodes"] if n["id"] == "node_video")
    assert node["kind"] == "video"
    assert node["media"]["videoId"] == "dQw4w9WgXcQ"


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


async def test_snapshot_created_on_mutation(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    before = await client.get("/admin/canvas/main/snapshots", headers=headers)
    assert before.status_code == 200, before.text
    pre_count = len(before.json())

    create = await client.post(
        "/canvas/main/nodes",
        json={"id": "node_snap_one", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "text": "s"},
        headers=headers,
    )
    assert create.status_code == 201, create.text

    after = await client.get("/admin/canvas/main/snapshots", headers=headers)
    assert after.status_code == 200
    rows = after.json()
    assert len(rows) >= pre_count + 1
    assert rows[0]["comment"] == "node_created"
    assert rows[0]["revision"] >= 1


async def test_snapshot_requires_admin(client):
    resp = await client.get("/admin/canvas/main/snapshots")
    assert resp.status_code == 401


async def test_snapshot_restore_flow(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}

    create = await client.post(
        "/canvas/main/nodes",
        json={"id": "node_restore_marker", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "text": "before"},
        headers=headers,
    )
    assert create.status_code == 201, create.text

    snaps = await client.get("/admin/canvas/main/snapshots", headers=headers)
    target = snaps.json()[0]
    target_id = target["id"]
    target_rev = target["revision"]

    patch = await client.patch(
        "/canvas/main/nodes/node_restore_marker",
        json={"text": "after"},
        headers=headers,
    )
    assert patch.status_code == 200

    detail = await client.get(f"/admin/canvas/main/snapshots/{target_id}", headers=headers)
    assert detail.status_code == 200, detail.text
    snap_body = detail.json()
    assert snap_body["revision"] == target_rev
    assert any(n["id"] == "node_restore_marker" and n.get("text") == "before"
               for n in snap_body["data"]["nodes"])

    restore = await client.post(
        f"/admin/canvas/main/snapshots/{target_id}/restore",
        headers=headers,
    )
    assert restore.status_code == 200, restore.text
    body = restore.json()
    assert body["revision"] > target_rev
    nodes = body["data"]["nodes"]
    assert any(n["id"] == "node_restore_marker" and n.get("text") == "before" for n in nodes)

    audit = await client.get("/admin/audit", headers=headers)
    actions = [r["action"] for r in audit.json()]
    assert "canvas_restored" in actions


async def test_presence_broadcast_via_ws_hello(client, admin_token):
    from app.ws import manager

    presence_msgs: list[dict] = []

    class _Sink:
        async def send_json(self, msg: dict) -> None:
            presence_msgs.append(msg)

    sink = _Sink()
    async with manager._lock:
        manager._rooms.setdefault("main", set()).add(sink)

    try:
        await manager.register_presence("main", sink, "presence-test-c1", "alice")
        users = manager.presence_users("main")
        assert any(u["client_id"] == "presence-test-c1" and u["username"] == "alice" for u in users)
        assert any(m.get("type") == "presence" for m in presence_msgs)
    finally:
        await manager._remove_presence("main", "presence-test-c1")
        async with manager._lock:
            room = manager._rooms.get("main")
            if room is not None:
                room.discard(sink)


async def test_edge_label_rich_round_trip(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}", "X-Client-Id": "edge-label-rich"}
    rev0 = (await client.get("/canvas/main")).json()["revision"]
    body = {
        "data": {
            "nodes": [
                {"id": "rich_a", "type": "file", "x": 0, "y": 0, "width": 100, "height": 100, "file": "a.webp", "kind": "block"},
                {"id": "rich_b", "type": "file", "x": 200, "y": 0, "width": 100, "height": 100, "file": "b.webp", "kind": "block"},
            ],
            "edges": [
                {
                    "id": "edge_rich",
                    "fromNode": "rich_a",
                    "toNode": "rich_b",
                    "routing": "orthogonal",
                    "style": "solid",
                    "label": {
                        "text": "styled",
                        "position": {"x": 150, "y": 250},
                        "fontSize": 20,
                        "color": "#e86b2e",
                        "rotation": 45,
                    },
                }
            ],
        },
        "expected_revision": rev0,
    }
    put_resp = await client.put("/canvas/main", json=body, headers=headers)
    assert put_resp.status_code == 200, put_resp.text
    snap = await client.get("/canvas/main")
    edge = next(e for e in snap.json()["data"]["edges"] if e["id"] == "edge_rich")
    assert edge["label"]["fontSize"] == 20
    assert edge["label"]["color"] == "#e86b2e"
    assert edge["label"]["rotation"] == 45

    rev1 = snap.json()["revision"]
    patch_resp = await client.patch(
        "/canvas/main/edges/edge_rich",
        json={"label": {"text": "styled", "position": None, "fontSize": 12, "color": "auto", "rotation": 0}},
        headers=headers,
    )
    assert patch_resp.status_code == 200, patch_resp.text
    snap2 = await client.get("/canvas/main")
    edge2 = next(e for e in snap2.json()["data"]["edges"] if e["id"] == "edge_rich")
    assert edge2["label"]["fontSize"] == 12
    assert edge2["label"]["color"] == "auto"
    assert edge2["label"]["rotation"] == 0
    assert snap2.json()["revision"] == rev1 + 1


async def test_edge_label_legacy_compat(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}", "X-Client-Id": "edge-label-legacy"}
    rev0 = (await client.get("/canvas/main")).json()["revision"]
    body = {
        "data": {
            "nodes": [
                {"id": "legacy_a", "type": "file", "x": 0, "y": 0, "width": 50, "height": 50, "file": "a.webp", "kind": "block"},
                {"id": "legacy_b", "type": "file", "x": 100, "y": 0, "width": 50, "height": 50, "file": "b.webp", "kind": "block"},
            ],
            "edges": [
                {
                    "id": "edge_legacy",
                    "fromNode": "legacy_a",
                    "toNode": "legacy_b",
                    "routing": "orthogonal",
                    "style": "solid",
                    "label": "plain text label",
                }
            ],
        },
        "expected_revision": rev0,
    }
    put_resp = await client.put("/canvas/main", json=body, headers=headers)
    assert put_resp.status_code == 200, put_resp.text
    snap = await client.get("/canvas/main")
    edge = next(e for e in snap.json()["data"]["edges"] if e["id"] == "edge_legacy")
    assert edge["label"] == "plain text label"
