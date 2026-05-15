"""In-memory WebSocket manager for canvas broadcasts. Also tracks presence
(client_id -> {username, connected_at}) per canvas and broadcasts a `presence`
message whenever the membership changes. Also owns the per-canvas node-lock
registry used by the locked-by-user indicator."""

import asyncio
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket


LOCK_TIMEOUT_SECONDS = 60


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_monotonic() -> float:
    return time.monotonic()


class CanvasWSManager:
    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = {}
        self._presence: dict[str, dict[str, dict[str, Any]]] = {}
        self._sock_keys: dict[int, tuple[str, str]] = {}
        self._node_locks: dict[str, dict[str, dict[str, Any]]] = {}
        self._lock = asyncio.Lock()
        self._sweeper_task: asyncio.Task | None = None

    async def connect(self, canvas_id: str, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._rooms.setdefault(canvas_id, set()).add(ws)
        self._ensure_sweeper()

    async def disconnect(self, canvas_id: str, ws: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.get(canvas_id)
            if room is not None:
                room.discard(ws)
                if not room:
                    self._rooms.pop(canvas_id, None)
            key = self._sock_keys.pop(id(ws), None)
            locks_to_release = []
            if key is not None:
                client_id = key[1]
                room_locks = self._node_locks.get(canvas_id)
                if room_locks:
                    for node_id, info in list(room_locks.items()):
                        if info.get("client_id") == client_id:
                            locks_to_release.append((node_id, client_id))
        if key is not None:
            await self._remove_presence(canvas_id, key[1])
        for node_id, client_id in locks_to_release:
            await self.release_node_lock(canvas_id, node_id, client_id, exclude_ws=None)

    async def register_presence(
        self,
        canvas_id: str,
        ws: WebSocket,
        client_id: str,
        username: str,
    ) -> None:
        if not client_id:
            return
        async with self._lock:
            self._presence.setdefault(canvas_id, {})[client_id] = {
                "client_id": client_id,
                "username": username or "anonymous",
                "connected_at": _utcnow_iso(),
            }
            self._sock_keys[id(ws)] = (canvas_id, client_id)
        await self._broadcast_presence(canvas_id)

    async def _remove_presence(self, canvas_id: str, client_id: str) -> None:
        async with self._lock:
            room = self._presence.get(canvas_id)
            if room is not None:
                room.pop(client_id, None)
                if not room:
                    self._presence.pop(canvas_id, None)
        await self._broadcast_presence(canvas_id)

    def presence_users(self, canvas_id: str) -> list[dict[str, Any]]:
        room = self._presence.get(canvas_id) or {}
        return list(room.values())

    async def _broadcast_presence(self, canvas_id: str) -> None:
        users = self.presence_users(canvas_id)
        await self.broadcast(canvas_id, {"type": "presence", "users": users})

    async def broadcast(self, canvas_id: str, message: dict[str, Any], exclude_ws: WebSocket | None = None) -> None:
        async with self._lock:
            targets = [ws for ws in self._rooms.get(canvas_id, ()) if ws is not exclude_ws]
        if not targets:
            return
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                room = self._rooms.get(canvas_id)
                if room is not None:
                    for ws in dead:
                        room.discard(ws)

    async def register_node_lock(
        self,
        canvas_id: str,
        node_id: str,
        client_id: str,
        username: str,
        exclude_ws: WebSocket | None = None,
    ) -> None:
        if not node_id or not client_id:
            return
        async with self._lock:
            room = self._node_locks.setdefault(canvas_id, {})
            room[node_id] = {
                "node_id": node_id,
                "client_id": client_id,
                "username": username or "anonymous",
                "expires_at": _now_monotonic() + LOCK_TIMEOUT_SECONDS,
            }
        await self.broadcast(canvas_id, {
            "type": "node_locked",
            "node_id": node_id,
            "client_id": client_id,
            "username": username or "anonymous",
        }, exclude_ws=exclude_ws)

    async def release_node_lock(
        self,
        canvas_id: str,
        node_id: str,
        client_id: str,
        exclude_ws: WebSocket | None = None,
    ) -> None:
        removed = False
        async with self._lock:
            room = self._node_locks.get(canvas_id)
            if room is not None:
                cur = room.get(node_id)
                if cur and cur.get("client_id") == client_id:
                    room.pop(node_id, None)
                    removed = True
                if not room:
                    self._node_locks.pop(canvas_id, None)
        if removed:
            await self.broadcast(canvas_id, {
                "type": "node_unlocked",
                "node_id": node_id,
                "client_id": client_id,
            }, exclude_ws=exclude_ws)

    async def refresh_node_lock(self, canvas_id: str, node_id: str, client_id: str) -> None:
        async with self._lock:
            room = self._node_locks.get(canvas_id)
            if not room:
                return
            cur = room.get(node_id)
            if not cur or cur.get("client_id") != client_id:
                return
            cur["expires_at"] = _now_monotonic() + LOCK_TIMEOUT_SECONDS

    def snapshot_locks(self, canvas_id: str) -> list[dict[str, Any]]:
        room = self._node_locks.get(canvas_id) or {}
        return [
            {"node_id": v["node_id"], "client_id": v["client_id"], "username": v["username"]}
            for v in room.values()
        ]

    def _ensure_sweeper(self) -> None:
        if self._sweeper_task is not None and not self._sweeper_task.done():
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self._sweeper_task = loop.create_task(self._sweep_loop())

    async def _sweep_loop(self) -> None:
        try:
            while True:
                await asyncio.sleep(15)
                await self._sweep_expired()
        except asyncio.CancelledError:
            return

    async def _sweep_expired(self) -> None:
        expired: list[tuple[str, str, str]] = []
        now = _now_monotonic()
        async with self._lock:
            for cid, room in list(self._node_locks.items()):
                for node_id, info in list(room.items()):
                    exp = info.get("expires_at")
                    if not isinstance(exp, (int, float)):
                        continue
                    if exp < now:
                        room.pop(node_id, None)
                        expired.append((cid, node_id, info.get("client_id", "")))
                if not room:
                    self._node_locks.pop(cid, None)
        for canvas_id, node_id, client_id in expired:
            await self.broadcast(canvas_id, {
                "type": "node_unlocked",
                "node_id": node_id,
                "client_id": client_id,
            })


manager = CanvasWSManager()
