"""GitHub repository importer. Walks a repo tree, fetches blobs, and turns
files into canvas nodes: markdown -> text node, images -> file node with
uploaded bytes, json/csv/etc -> document node, pdf -> document node. Folders
become group nodes (one per unique path). Frontmatter on markdown is parsed
into node fields. Concurrency limited to 8 parallel blob fetches."""

import asyncio
import base64
import hashlib
import os
import re
import uuid
from copy import deepcopy
from typing import Any

import httpx
import yaml

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import CanvasImage

MAX_BLOB_BYTES = 50 * 1024 * 1024
CONCURRENT_FETCHES = 8

TEXT_EXT_KIND = {
    ".md": ("text", "text/markdown"),
    ".markdown": ("text", "text/markdown"),
}
IMAGE_EXT_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
}
DOC_EXT_MIME = {
    ".json": "application/json",
    ".csv": "text/csv",
    ".xml": "application/xml",
    ".html": "text/html",
    ".htm": "text/html",
    ".txt": "text/plain",
    ".py": "text/x-python",
    ".js": "application/javascript",
    ".sh": "application/x-sh",
    ".css": "text/css",
    ".pdf": "application/pdf",
    # Binary / archive formats accepted as document-nodes (raw bytes kept;
    # rendering side will show a file-icon placeholder). Skipped if size
    # exceeds MAX_BLOB_BYTES.
    ".dat":  "application/octet-stream",
    ".bin":  "application/octet-stream",
    ".raw":  "application/octet-stream",
    ".7z":   "application/x-7z-compressed",
    ".zip":  "application/zip",
    ".tar":  "application/x-tar",
    ".gz":   "application/gzip",
    ".log":  "text/plain",
    ".yaml": "application/yaml",
    ".yml":  "application/yaml",
    ".toml": "application/toml",
    ".ini":  "text/plain",
    ".md5":  "text/plain",
    ".sha":  "text/plain",
    ".sha256": "text/plain",
}
ALL_IMAGE_MIMES = set(IMAGE_EXT_MIME.values())
ALL_DOC_MIMES = set(DOC_EXT_MIME.values())


class GitHubImportError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _frontmatter_split(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---"):
        return {}, text
    lines = text.split("\n", 1)
    if len(lines) < 2:
        return {}, text
    end = re.search(r"\n---\s*(\n|$)", text[3:])
    if not end:
        return {}, text
    yaml_block = text[3 : 3 + end.start()]
    rest = text[3 + end.end():]
    try:
        loaded = yaml.safe_load(yaml_block)
    except yaml.YAMLError:
        return {}, text
    if not isinstance(loaded, dict):
        return {}, text
    return loaded, rest


def _classify(path: str) -> tuple[str | None, str | None, str | None]:
    lower = path.lower()
    ext = os.path.splitext(lower)[1]
    if ext in TEXT_EXT_KIND:
        kind, mime = TEXT_EXT_KIND[ext]
        return kind, None, mime
    if ext in IMAGE_EXT_MIME:
        return "block", "file", IMAGE_EXT_MIME[ext]
    if ext == ".pdf":
        return "document", None, "application/pdf"
    if ext in DOC_EXT_MIME:
        return "document", None, DOC_EXT_MIME[ext]
    return None, None, None


def _slug_from_path(path: str) -> str:
    base = os.path.splitext(os.path.basename(path))[0]
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", base).strip("-").lower()
    if not slug:
        slug = "node"
    return slug[:80]


def _node_id_from_path(path: str, used: set[str]) -> str:
    base = re.sub(r"[^a-zA-Z0-9_./-]+", "-", path).strip("-/").lower()
    base = base.replace("/", "_").replace(".", "_")
    if not base:
        base = "node"
    candidate = base
    counter = 2
    while candidate in used:
        candidate = f"{base}-{counter}"
        counter += 1
    used.add(candidate)
    return candidate


def _group_id(folder_path: str, used: set[str]) -> str:
    base = "group_" + re.sub(r"[^a-zA-Z0-9_./-]+", "-", folder_path).strip("-/").lower()
    base = base.replace("/", "_").replace(".", "_")
    if base == "group_":
        base = "group_root"
    candidate = base
    counter = 2
    while candidate in used:
        candidate = f"{base}-{counter}"
        counter += 1
    used.add(candidate)
    return candidate


def _split_path(path: str) -> tuple[str, str]:
    parts = path.rstrip("/").split("/")
    if len(parts) <= 1:
        return "", parts[-1]
    return "/".join(parts[:-1]), parts[-1]


def _all_parent_folders(path: str) -> list[str]:
    parts = path.split("/")
    out: list[str] = []
    for i in range(1, len(parts)):
        out.append("/".join(parts[:i]))
    return out


def _headers(token: str | None) -> dict[str, str]:
    h = {"Accept": "application/vnd.github+json", "User-Agent": "inside-arg-map"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


async def fetch_tree(
    client: httpx.AsyncClient,
    owner: str,
    repo: str,
    branch: str,
    token: str | None,
) -> list[dict[str, Any]]:
    url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1"
    try:
        r = await client.get(url, headers=_headers(token), timeout=30.0)
    except httpx.HTTPError as exc:
        raise GitHubImportError(502, f"GitHub fetch failed: {exc}") from exc
    if r.status_code == 404:
        raise GitHubImportError(404, "Repository or branch not found")
    if r.status_code == 401:
        raise GitHubImportError(401, "Invalid GitHub token")
    if r.status_code == 403:
        raise GitHubImportError(403, "GitHub rate limit exceeded or access denied")
    if r.status_code >= 400:
        raise GitHubImportError(r.status_code, f"GitHub error: {r.status_code}")
    body = r.json()
    tree = body.get("tree")
    if not isinstance(tree, list):
        raise GitHubImportError(502, "Unexpected GitHub tree shape")
    return tree


async def fetch_blob(
    client: httpx.AsyncClient,
    owner: str,
    repo: str,
    sha: str,
    token: str | None,
    sem: asyncio.Semaphore,
) -> bytes:
    async with sem:
        url = f"https://api.github.com/repos/{owner}/{repo}/git/blobs/{sha}"
        try:
            r = await client.get(url, headers=_headers(token), timeout=30.0)
        except httpx.HTTPError as exc:
            raise GitHubImportError(502, f"Blob fetch failed: {exc}") from exc
        if r.status_code >= 400:
            raise GitHubImportError(r.status_code, f"Blob fetch failed: {r.status_code}")
        body = r.json()
        encoding = body.get("encoding")
        content = body.get("content", "")
        if encoding == "base64":
            raw = base64.b64decode(content)
        elif encoding == "utf-8":
            raw = content.encode("utf-8")
        else:
            raw = content.encode("utf-8") if isinstance(content, str) else b""
        if len(raw) > MAX_BLOB_BYTES:
            raise GitHubImportError(413, f"Blob too large: {len(raw)} bytes")
        return raw


async def _store_bytes(
    db: AsyncSession,
    user_id: uuid.UUID,
    canvas_id: str,
    mime: str,
    blob: bytes,
) -> str:
    digest = hashlib.sha256(blob).hexdigest()
    existing = await db.scalar(select(CanvasImage).where(CanvasImage.sha256 == digest))
    if existing is not None:
        return f"/canvas/{canvas_id}/images/{existing.id}"
    record = CanvasImage(
        sha256=digest,
        mime=mime,
        size=len(blob),
        data=blob,
        created_by_user_id=user_id,
    )
    db.add(record)
    await db.flush()
    return f"/canvas/{canvas_id}/images/{record.id}"


def _coerce_tags(val: Any) -> list[str]:
    if isinstance(val, list):
        return [str(x) for x in val if isinstance(x, (str, int, float))]
    if isinstance(val, str):
        return [s.strip() for s in re.split(r"[,;]", val) if s.strip()]
    return []


def _coerce_branches(val: Any) -> list[str]:
    if isinstance(val, list):
        return [str(x) for x in val if isinstance(x, str)]
    if isinstance(val, str):
        return [s.strip() for s in re.split(r"[,;]", val) if s.strip()]
    return []


def _apply_frontmatter(node: dict[str, Any], fm: dict[str, Any]) -> None:
    if "title" in fm and isinstance(fm["title"], (str, int, float)):
        node["label"] = str(fm["title"])
    if "status" in fm and isinstance(fm["status"], str):
        node["status"] = fm["status"]
    if "tags" in fm:
        node["tags"] = _coerce_tags(fm["tags"])
    if "branches" in fm:
        node["branches"] = _coerce_branches(fm["branches"])
    for fld in ("verification", "source_url", "tool", "technique"):
        if fld in fm and isinstance(fm[fld], str):
            node[fld] = fm[fld]


def _layout_grid(
    file_entries: list[dict[str, Any]],
    folder_layout: bool,
) -> dict[str, dict[str, int]]:
    """Position files on the canvas.

    folder_layout=False  → flat grid, 6 files per row, in input order.
    folder_layout=True   → recursive folder-tree layout: a parent folder
      lays out its files in a vertical stack on the LEFT, then its
      subfolders side-by-side on the RIGHT, recursively. This produces a
      tree-like visual where nested folders nest visually too, instead of
      every folder becoming a top-level column (the old behavior).
    """
    column_w = 260
    row_h = 180
    margin = 60
    cell_w = column_w - 20
    cell_h = row_h - 20

    if not folder_layout:
        placements: dict[str, dict[str, int]] = {}
        per_row = 6
        for i, e in enumerate(file_entries):
            placements[e["path"]] = {
                "x": (i % per_row) * (column_w + margin // 2),
                "y": (i // per_row) * (row_h + margin // 2),
                "w": cell_w,
                "h": cell_h,
            }
        return placements

    # Build folder tree: map "parent_folder" -> { files: [...], subfolders: set }
    # using the relpaths.
    children_of: dict[str, list[str]] = {}
    files_in: dict[str, list[dict[str, Any]]] = {}
    all_folders: set[str] = set()
    for e in file_entries:
        folder, _ = _split_path(e["relpath"])
        files_in.setdefault(folder, []).append(e)
        # Walk every ancestor folder.
        parts = folder.split("/") if folder else []
        cur = ""
        for part in parts:
            parent = cur
            cur = f"{cur}/{part}" if cur else part
            all_folders.add(cur)
            if cur not in children_of.get(parent, []):
                children_of.setdefault(parent, []).append(cur)
        all_folders.add(folder)

    # Make sure root entry exists and that children lists are sorted/unique.
    if "" not in children_of:
        children_of[""] = []
    # Top-level folders are roots; collect them in sorted order.
    top_folders = sorted({f.split("/")[0] for f in all_folders if f})
    for parent in list(children_of.keys()):
        children_of[parent] = sorted(set(children_of[parent]))
    # Add root's top-level folders if not already there.
    children_of[""] = sorted(set(children_of.get("", []) + top_folders))

    placements: dict[str, dict[str, int]] = {}

    def layout(folder: str, origin_x: int, origin_y: int) -> tuple[int, int]:
        """Lay out `folder`'s files and subfolders starting at (origin_x, origin_y).
        Returns the (width, height) consumed."""
        files = files_in.get(folder, [])
        # Files stacked vertically in a single column.
        files_h = max(0, len(files) * row_h)
        # Place files.
        for i, e in enumerate(files):
            placements[e["path"]] = {
                "x": origin_x,
                "y": origin_y + i * row_h,
                "w": cell_w,
                "h": cell_h,
            }
        # Subfolders go to the RIGHT of the files column.
        sub_origin_x = origin_x + (column_w + margin if files else 0)
        sub_origin_y = origin_y
        subs = children_of.get(folder, [])
        if not subs:
            return (cell_w, files_h)
        sub_w_total = 0
        sub_h_max = 0
        for sub in subs:
            sw, sh = layout(sub, sub_origin_x + sub_w_total, sub_origin_y)
            sub_w_total += sw + margin
            if sh > sub_h_max:
                sub_h_max = sh
        # Trim trailing margin.
        sub_w_total = max(0, sub_w_total - margin)
        total_w = (cell_w + margin if files else 0) + sub_w_total
        total_h = max(files_h, sub_h_max)
        return (total_w, total_h)

    # Root has no own files in the typical case (top-level files at "" go in
    # the root row); subfolders fan out to the right.
    layout("", 0, 0)
    return placements


def _group_rect_for_folder(
    folder: str,
    placements: dict[str, dict[str, int]],
    files_in_folder: list[str],
) -> dict[str, int]:
    if not files_in_folder:
        return {"x": 0, "y": 0, "w": 240, "h": 200}
    min_x = min(placements[p]["x"] for p in files_in_folder) - 20
    min_y = min(placements[p]["y"] for p in files_in_folder) - 60
    max_x = max(placements[p]["x"] + placements[p]["w"] for p in files_in_folder) + 20
    max_y = max(placements[p]["y"] + placements[p]["h"] for p in files_in_folder) + 20
    return {"x": min_x, "y": min_y, "w": max_x - min_x, "h": max_y - min_y}


async def build_import_plan(
    db: AsyncSession,
    user_id: uuid.UUID,
    canvas_id: str,
    owner: str,
    repo: str,
    branch: str,
    path_prefix: str,
    token: str | None,
    parse_frontmatter: bool,
    folder_layout: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Returns (nodes_to_create, groups_to_create, skipped). Side effect:
    uploads media to the CanvasImage table when dry_run==False (caller
    decides). Here we always upload binaries because we need their URLs to
    populate node.file. For dry_run, caller should rollback the session
    instead of committing."""
    async with httpx.AsyncClient() as client:
        tree = await fetch_tree(client, owner, repo, branch, token)
        prefix = path_prefix.strip().strip("/")
        plan_files: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        for entry in tree:
            if not isinstance(entry, dict):
                continue
            if entry.get("type") != "blob":
                continue
            path = entry.get("path")
            sha = entry.get("sha")
            if not isinstance(path, str) or not isinstance(sha, str):
                continue
            size = entry.get("size") if isinstance(entry.get("size"), int) else 0
            if prefix and not path.startswith(prefix + "/") and path != prefix:
                continue
            relpath = path[len(prefix) + 1:] if (prefix and path.startswith(prefix + "/")) else path
            kind, ntype, mime = _classify(relpath)
            if kind is None:
                skipped.append({"path": path, "reason": "unsupported_extension"})
                continue
            if size and size > MAX_BLOB_BYTES:
                skipped.append({"path": path, "reason": "too_large", "size": size})
                continue
            plan_files.append({
                "path": path,
                "relpath": relpath,
                "sha": sha,
                "size": size,
                "kind": kind,
                "ntype": ntype,
                "mime": mime,
            })
        sem = asyncio.Semaphore(CONCURRENT_FETCHES)

        async def _fetch(entry: dict[str, Any]) -> tuple[dict[str, Any], bytes | None]:
            try:
                blob = await fetch_blob(client, owner, repo, entry["sha"], token, sem)
                return entry, blob
            except GitHubImportError as exc:
                skipped.append({"path": entry["path"], "reason": exc.message})
                return entry, None
            except Exception as exc:
                skipped.append({"path": entry["path"], "reason": f"fetch_error: {exc}"})
                return entry, None

        results = await asyncio.gather(*[_fetch(e) for e in plan_files])

    placements = _layout_grid([r[0] for r in results if r[1] is not None], folder_layout)

    used_ids: set[str] = set()
    used_group_ids: set[str] = set()
    folder_to_group_id: dict[str, str] = {}
    nodes_to_create: list[dict[str, Any]] = []
    groups_to_create: list[dict[str, Any]] = []
    files_by_folder: dict[str, list[str]] = {}

    for entry, blob in results:
        if blob is None:
            continue
        rel = entry["relpath"]
        folder, _ = _split_path(rel)
        files_by_folder.setdefault(folder, []).append(rel)

    if folder_layout:
        all_folders: set[str] = set()
        for entry, blob in results:
            if blob is None:
                continue
            for f in _all_parent_folders(entry["relpath"]):
                all_folders.add(f)
        for folder in sorted(all_folders):
            gid = _group_id(folder, used_group_ids)
            folder_to_group_id[folder] = gid

    for entry, blob in results:
        if blob is None:
            continue
        rel = entry["relpath"]
        node_id = _node_id_from_path(rel, used_ids)
        pos = placements.get(entry["path"])
        if not pos:
            pos = {"x": 0, "y": 0, "w": 240, "h": 160}
        node: dict[str, Any] = {
            "id": node_id,
            "type": "text",
            "x": pos["x"],
            "y": pos["y"],
            "width": pos["w"],
            "height": pos["h"],
            "slug": _slug_from_path(rel),
            "github_path": rel,
            "name": os.path.basename(rel),
        }
        folder, _ = _split_path(rel)
        if folder_layout and folder in folder_to_group_id:
            node["parent"] = folder_to_group_id[folder]
        kind = entry["kind"]
        mime = entry["mime"]
        if kind == "text":
            text = blob.decode("utf-8", errors="replace")
            if parse_frontmatter:
                fm, rest = _frontmatter_split(text)
                node["text"] = rest if fm else text
                if fm:
                    _apply_frontmatter(node, fm)
            else:
                node["text"] = text
            node["kind"] = "text"
            if not node.get("label"):
                node["label"] = os.path.splitext(os.path.basename(rel))[0]
        elif kind == "block":
            url = await _store_bytes(db, user_id, canvas_id, mime, blob)
            node["type"] = "file"
            node["file"] = url
            node["kind"] = "block"
            node["mime"] = mime
        elif kind == "document":
            url = await _store_bytes(db, user_id, canvas_id, mime, blob)
            node["type"] = "file"
            node["file"] = url
            node["kind"] = "document"
            node["mime"] = mime
        nodes_to_create.append(node)

    if folder_layout:
        for folder, gid in folder_to_group_id.items():
            sub_files = files_by_folder.get(folder, [])
            sub_files_full: list[str] = []
            for entry, blob in results:
                if blob is None:
                    continue
                rel = entry["relpath"]
                sub_folder, _ = _split_path(rel)
                if sub_folder == folder or sub_folder.startswith(folder + "/"):
                    sub_files_full.append(entry["path"])
            if not sub_files_full:
                continue
            rect = _group_rect_for_folder(folder, placements, sub_files_full)
            parent_folder, _ = _split_path(folder)
            label = folder.split("/")[-1] if "/" in folder else folder
            group_node: dict[str, Any] = {
                "id": gid,
                "type": "group",
                "x": rect["x"],
                "y": rect["y"],
                "width": rect["w"],
                "height": rect["h"],
                "label": label or folder,
                "kind": "group",
                "github_path": folder,
            }
            if parent_folder and parent_folder in folder_to_group_id:
                group_node["parent"] = folder_to_group_id[parent_folder]
            groups_to_create.append(group_node)

    return nodes_to_create, groups_to_create, skipped


def merge_into_canvas(
    canvas_data: dict[str, Any],
    nodes_to_create: list[dict[str, Any]],
    groups_to_create: list[dict[str, Any]],
) -> dict[str, Any]:
    data = deepcopy(canvas_data) if isinstance(canvas_data, dict) else {}
    data.setdefault("nodes", [])
    data.setdefault("edges", [])
    existing_ids = {n.get("id") for n in data["nodes"] if isinstance(n, dict)}
    for g in groups_to_create:
        if g.get("id") not in existing_ids:
            data["nodes"].append(g)
            existing_ids.add(g.get("id"))
    for n in nodes_to_create:
        if n.get("id") not in existing_ids:
            data["nodes"].append(n)
            existing_ids.add(n.get("id"))
    return data


async def resync_node_blob(
    db: AsyncSession,
    user_id: uuid.UUID,
    canvas_id: str,
    owner: str,
    repo: str,
    branch: str,
    token: str | None,
    node: dict[str, Any],
) -> dict[str, Any]:
    path = node.get("github_path")
    if not isinstance(path, str) or not path:
        raise GitHubImportError(400, "node has no github_path")
    async with httpx.AsyncClient() as client:
        tree = await fetch_tree(client, owner, repo, branch, token)
        target: dict[str, Any] | None = None
        for entry in tree:
            if entry.get("path") == path and entry.get("type") == "blob":
                target = entry
                break
        if target is None:
            raise GitHubImportError(404, f"path not found in repo: {path}")
        sem = asyncio.Semaphore(1)
        blob = await fetch_blob(client, owner, repo, target["sha"], token, sem)
    kind, _ntype, mime = _classify(path)
    out = dict(node)
    if kind == "text":
        text = blob.decode("utf-8", errors="replace")
        fm, rest = _frontmatter_split(text)
        out["text"] = rest if fm else text
        if fm:
            _apply_frontmatter(out, fm)
    elif kind in {"block", "document"} and mime:
        url = await _store_bytes(db, user_id, canvas_id, mime, blob)
        out["file"] = url
        out["mime"] = mime
    return out
