"""Tests for share links, mentions, and the cursor_move WS broadcast."""

import pytest

pytestmark = pytest.mark.asyncio


async def test_share_link_create_and_fetch(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = await client.post(
        "/admin/share/create",
        json={"canvas_id": "main", "expires_in_hours": 24},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["token"]
    assert len(body["token"]) >= 16
    assert body["canvas_id"] == "main"
    assert body["share_url"].endswith(f"share={body['token']}")
    token = body["token"]

    public = await client.get(f"/share/{token}/canvas")
    assert public.status_code == 200, public.text
    pdata = public.json()
    assert pdata["readonly"] is True
    assert pdata["canvas_id"] == "main"
    assert isinstance(pdata["data"].get("nodes"), list)
    assert isinstance(pdata["data"].get("edges"), list)
    cache = public.headers.get("cache-control", "")
    assert "max-age" in cache


async def test_share_link_no_expiry(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = await client.post(
        "/admin/share/create",
        json={"canvas_id": "main"},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["expires_at"] is None
    public = await client.get(f"/share/{body['token']}/canvas")
    assert public.status_code == 200


async def test_share_link_revoke(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    create = await client.post(
        "/admin/share/create",
        json={"canvas_id": "main", "expires_in_hours": 1},
        headers=headers,
    )
    assert create.status_code == 201
    token = create.json()["token"]

    revoke = await client.post(f"/admin/share/{token}/revoke", headers=headers)
    assert revoke.status_code == 204

    public = await client.get(f"/share/{token}/canvas")
    assert public.status_code == 410


async def test_share_link_expired(client, admin_token):
    from datetime import datetime, timedelta, timezone

    from app.database import get_session_factory
    from app.models import ShareLink

    headers = {"Authorization": f"Bearer {admin_token}"}
    create = await client.post(
        "/admin/share/create",
        json={"canvas_id": "main", "expires_in_hours": 1},
        headers=headers,
    )
    assert create.status_code == 201
    token = create.json()["token"]

    factory = get_session_factory()
    async with factory() as session:
        from sqlalchemy import select
        row = await session.scalar(select(ShareLink).where(ShareLink.token == token))
        assert row is not None
        row.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        await session.commit()

    public = await client.get(f"/share/{token}/canvas")
    assert public.status_code == 410


async def test_share_link_invalid_token(client):
    resp = await client.get("/share/not-a-real-token/canvas")
    assert resp.status_code == 404


async def test_share_link_create_requires_admin(client):
    resp = await client.post(
        "/admin/share/create",
        json={"canvas_id": "main", "expires_in_hours": 1},
    )
    assert resp.status_code == 401


async def test_share_link_list(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    create = await client.post(
        "/admin/share/create",
        json={"canvas_id": "main", "expires_in_hours": 24},
        headers=headers,
    )
    assert create.status_code == 201
    token = create.json()["token"]

    listed = await client.get("/admin/share/list?canvas_id=main", headers=headers)
    assert listed.status_code == 200
    rows = listed.json()
    tokens = [r["token"] for r in rows]
    assert token in tokens

    await client.post(f"/admin/share/{token}/revoke", headers=headers)
    listed2 = await client.get("/admin/share/list?canvas_id=main", headers=headers)
    assert listed2.status_code == 200
    tokens2 = [r["token"] for r in listed2.json()]
    assert token not in tokens2


async def test_public_users_endpoint(client):
    resp = await client.get("/auth/users")
    assert resp.status_code == 200
    rows = resp.json()
    assert isinstance(rows, list)
    usernames = [r["username"] for r in rows]
    assert "admin" in usernames


async def test_mention_create_and_unread(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    create_user = await client.post(
        "/admin/users",
        json={"username": "mentionee", "password": "test-pw-1234", "is_admin": False},
        headers=headers,
    )
    assert create_user.status_code == 201, create_user.text

    create = await client.post(
        "/canvas/main/mentions",
        json={"to_username": "mentionee", "node_id": "node_x", "text_snippet": "hello @mentionee"},
        headers=headers,
    )
    assert create.status_code == 201, create.text
    mention_id = create.json()["id"]

    login = await client.post(
        "/auth/login",
        json={"username": "mentionee", "password": "test-pw-1234"},
    )
    assert login.status_code == 200
    other_token = login.json()["access_token"]
    other_headers = {"Authorization": f"Bearer {other_token}"}

    unread = await client.get("/canvas/main/mentions/unread", headers=other_headers)
    assert unread.status_code == 200, unread.text
    rows = unread.json()
    ids = [r["id"] for r in rows]
    assert mention_id in ids
    row = next(r for r in rows if r["id"] == mention_id)
    assert row["text_snippet"] == "hello @mentionee"
    assert row["node_id"] == "node_x"
    assert row["from_username"] == "admin"

    read = await client.post(
        f"/canvas/main/mentions/{mention_id}/read",
        headers=other_headers,
    )
    assert read.status_code == 204

    unread2 = await client.get("/canvas/main/mentions/unread", headers=other_headers)
    ids2 = [r["id"] for r in unread2.json()]
    assert mention_id not in ids2


async def test_mention_requires_auth(client):
    resp = await client.post(
        "/canvas/main/mentions",
        json={"to_username": "admin", "node_id": None, "text_snippet": "hi"},
    )
    assert resp.status_code == 401


async def test_mention_unknown_username(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    resp = await client.post(
        "/canvas/main/mentions",
        json={"to_username": "no-such-user-xyz", "text_snippet": "hello"},
        headers=headers,
    )
    assert resp.status_code == 404


async def test_mention_read_only_own(client, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    other_resp = await client.post(
        "/admin/users",
        json={"username": "third-party", "password": "test-pw-1234", "is_admin": False},
        headers=headers,
    )
    assert other_resp.status_code == 201

    target_resp = await client.post(
        "/admin/users",
        json={"username": "target-user", "password": "test-pw-1234", "is_admin": False},
        headers=headers,
    )
    assert target_resp.status_code == 201

    create = await client.post(
        "/canvas/main/mentions",
        json={"to_username": "target-user", "text_snippet": "msg"},
        headers=headers,
    )
    mention_id = create.json()["id"]

    other_login = await client.post(
        "/auth/login",
        json={"username": "third-party", "password": "test-pw-1234"},
    )
    other_headers = {"Authorization": f"Bearer {other_login.json()['access_token']}"}

    resp = await client.post(
        f"/canvas/main/mentions/{mention_id}/read",
        headers=other_headers,
    )
    assert resp.status_code == 404


async def test_ws_cursor_move_broadcast():
    from app.ws import manager

    sender_msgs: list[dict] = []
    receiver_msgs: list[dict] = []

    class _Sink:
        def __init__(self, store: list) -> None:
            self.store = store

        async def send_json(self, msg: dict) -> None:
            self.store.append(msg)

    sender = _Sink(sender_msgs)
    receiver = _Sink(receiver_msgs)
    async with manager._lock:
        manager._rooms.setdefault("main", set()).add(sender)
        manager._rooms.setdefault("main", set()).add(receiver)
    try:
        await manager.broadcast(
            "main",
            {
                "type": "cursor_move",
                "client_id": "cursor-client-1",
                "username": "alice",
                "x_image": 12.5,
                "y_image": 34.25,
            },
            exclude_ws=sender,
        )
        assert receiver_msgs
        msg = receiver_msgs[-1]
        assert msg["type"] == "cursor_move"
        assert msg["client_id"] == "cursor-client-1"
        assert msg["x_image"] == 12.5
        assert msg["y_image"] == 34.25
        assert not sender_msgs
    finally:
        async with manager._lock:
            room = manager._rooms.get("main")
            if room is not None:
                room.discard(sender)
                room.discard(receiver)
