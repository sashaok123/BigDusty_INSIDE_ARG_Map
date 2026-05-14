"""Pydantic request and response schemas."""

import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    username: str = Field(..., validation_alias="username_display")
    is_admin: bool


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=256)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    user: UserOut


class RefreshRequest(BaseModel):
    refresh_token: str


class AccessToken(BaseModel):
    access_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8, max_length=256)


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=8, max_length=256)
    is_admin: bool = False


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=8, max_length=256)


class PatchUserRequest(BaseModel):
    is_admin: bool | None = None


class InvitationCreateRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    is_admin: bool = False


class InvitationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    username: str = Field(..., validation_alias="username_display")
    expires_at: Any
    used_at: Any | None = None
    is_admin_initial: bool
    setup_url: str | None = None
    token: str | None = None


class InvitationCheckOut(BaseModel):
    valid: bool
    username: str | None = None
    expires_at: Any | None = None
    is_admin_initial: bool = False


class SetupAccountRequest(BaseModel):
    token: str = Field(..., min_length=1, max_length=128)
    password: str = Field(..., min_length=8, max_length=256)


class CanvasOut(BaseModel):
    revision: int
    data: dict[str, Any]


class CanvasRevisionOut(BaseModel):
    revision: int


class CanvasReplaceRequest(BaseModel):
    data: dict[str, Any]
    expected_revision: int


class NodeCreateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(..., min_length=1, max_length=128)


class NodePatchRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


class EdgeCreateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(..., min_length=1, max_length=128)


class EdgePatchRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


ChangeKind = Literal[
    "node_created",
    "node_updated",
    "node_deleted",
    "edge_created",
    "edge_updated",
    "edge_deleted",
    "canvas_replaced",
]


class CanvasChange(BaseModel):
    kind: ChangeKind
    id: str | None = None
    data: dict[str, Any] | None = None


class AuditEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user_id: uuid.UUID | None = None
    action: str
    payload: dict[str, Any] | None = None
    created_at: Any


class CommentCreateRequest(BaseModel):
    x: float
    y: float
    body: str = Field(..., min_length=1, max_length=4000)


class CommentReplyRequest(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)


class CommentMessage(BaseModel):
    author: str
    body: str
    at: Any


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    canvas_id: str
    x: float
    y: float
    thread: list[CommentMessage]
    created_at: Any


class SnapshotSummary(BaseModel):
    id: uuid.UUID
    revision: int
    created_at: Any
    created_by: str | None = None
    comment: str | None = None


class SnapshotOut(BaseModel):
    id: uuid.UUID
    canvas_id: str
    revision: int
    data: dict[str, Any]
    comment: str | None = None
    created_by: str | None = None
    created_at: Any


class SnapshotRestoreOut(BaseModel):
    revision: int
    data: dict[str, Any]
    snapshot_id: uuid.UUID
