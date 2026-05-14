"""In-memory WebSocket manager for canvas broadcasts."""

import asyncio
from typing import Any

from fastapi import WebSocket


class CanvasWSManager:
    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = {}
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
