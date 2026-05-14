"""In-memory WebSocket manager for canvas broadcasts. Also tracks presence
(client_id -> {username, connected_at}) per canvas and broadcasts a `presence`
message whenever the membership changes."""

import asyncio
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class CanvasWSManager:
    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = {}
        self._presence: dict[str, dict[str, dict[str, Any]]] = {}
        self._sock_keys: dict[int, tuple[str, str]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, canvas_id: str, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._rooms.setdefault(canvas_id, set()).add(ws)

    async def disconnect(self, canvas_id: str, ws: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.get(canvas_id)
            if room is not None:
                room.discard(ws)
                if not room:
                    self._rooms.pop(canvas_id, None)
            key = self._sock_keys.pop(id(ws), None)
        if key is not None:
            await self._remove_presence(canvas_id, key[1])

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

    async def broadcast(self, canvas_id: str, message: dict[str, Any]) -> None:
        async with self._lock:
            targets = list(self._rooms.get(canvas_id, ()))
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


manager = CanvasWSManager()
