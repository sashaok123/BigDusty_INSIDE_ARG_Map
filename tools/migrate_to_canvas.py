"""Convert legacy data/{blocks_raw,hotspots,arrows}.json to data/canvas.canvas.

JSON Canvas v1.0 (https://jsoncanvas.org/spec/1.0/) with project-specific
extension fields. Idempotent: rerunning regenerates the canvas.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"

BLOCKS_FILE = DATA / "blocks_raw.json"
HOTSPOTS_FILE = DATA / "hotspots.json"
ARROWS_FILE = DATA / "arrows.json"
PUZZLES_DIR = DATA / "puzzles"
OUTPUT_FILE = DATA / "canvas.canvas"

KIND_ROUTING = {
    "orthogonal": "orthogonal",
    "manhattan": "manhattan",
    "bezier": "smooth",
    "straight": "straight",
}

SIDE_FIXED_POINT = {
    "left":   [0.0, 0.5],
    "right":  [1.0, 0.5],
    "top":    [0.5, 0.0],
    "bottom": [0.5, 1.0],
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def read_puzzle_md(slug: str) -> str:
    p = PUZZLES_DIR / f"{slug}.md"
    if p.is_file():
        return p.read_text(encoding="utf-8")
    return f"# {slug}\n\nNo markdown file at data/puzzles/{slug}.md yet.\n"


def block_to_node(block: dict) -> dict:
    rect = block["rect"]
    return {
        "id": block["id"],
        "type": "file",
        "x": int(rect["x"]),
        "y": int(rect["y"]),
        "width": int(rect["w"]),
        "height": int(rect["h"]),
        "file": block.get("file") or f"data/blocks/{block['id']}.webp",
        "status": "no-data",
        "tags": [],
        "kind": "block",
    }


def hotspot_to_node(hotspot: dict, file_ids: set[str]) -> dict:
    rect = hotspot.get("rect") or {}
    slug = hotspot.get("slug") or hotspot.get("id") or "untitled"
    md_body = read_puzzle_md(slug)
    legacy_status = hotspot.get("status") or "unsolved"
    status_map = {
        "solved": "solved",
        "partial": "partial",
        "unsolved": "unsolved",
        "nodata": "no-data",
    }
    status = status_map.get(legacy_status, "unsolved")
    node = {
        "id": hotspot["id"],
        "type": "text",
        "x": int(rect.get("x", 0)),
        "y": int(rect.get("y", 0)),
        "width": int(rect.get("w", 300)),
        "height": int(rect.get("h", 180)),
        "text": md_body,
        "status": status,
        "tags": list(hotspot.get("tags") or []),
        "kind": "puzzle",
        "slug": slug,
    }
    block_id = hotspot.get("block_id")
    if isinstance(block_id, str) and block_id in file_ids:
        node["parent"] = block_id
    return node


def arrow_endpoint_binding(endpoint: dict) -> dict:
    side = endpoint.get("side") if isinstance(endpoint, dict) else None
    fixed = SIDE_FIXED_POINT.get(side, [0.5, 0.5])
    return {"mode": "orbit", "fixedPoint": fixed}


def arrow_to_edge(arrow: dict) -> dict | None:
    src = arrow.get("from") or {}
    dst = arrow.get("to") or {}
    src_block = src.get("block_id") if isinstance(src, dict) else None
    dst_block = dst.get("block_id") if isinstance(dst, dict) else None
    if not src_block or not dst_block:
        return None
    kind = arrow.get("kind", "orthogonal")
    routing = KIND_ROUTING.get(kind, "orthogonal")
    style = arrow.get("style", "solid")
    if style not in {"solid", "dashed", "dotted"}:
        style = "solid"
    edge = {
        "id": arrow["id"],
        "fromNode": src_block,
        "toNode": dst_block,
        "routing": routing,
        "style": style,
        "bindings": {
            "from": arrow_endpoint_binding(src),
            "to": arrow_endpoint_binding(dst),
        },
    }
    side_a = src.get("side") if isinstance(src, dict) else None
    side_b = dst.get("side") if isinstance(dst, dict) else None
    if side_a in {"left", "right", "top", "bottom"}:
        edge["fromSide"] = side_a
    if side_b in {"left", "right", "top", "bottom"}:
        edge["toSide"] = side_b
    label = arrow.get("label")
    if isinstance(label, str) and label:
        edge["label"] = label
    return edge


def build_canvas() -> dict:
    blocks_data = load_json(BLOCKS_FILE)
    hotspots_data = load_json(HOTSPOTS_FILE)
    arrows_data = load_json(ARROWS_FILE)

    file_nodes = [block_to_node(b) for b in blocks_data.get("blocks", [])]
    file_ids = {n["id"] for n in file_nodes}
    text_nodes = [
        hotspot_to_node(h, file_ids)
        for h in hotspots_data.get("hotspots", [])
    ]

    edges = []
    for arrow in arrows_data.get("arrows", []):
        edge = arrow_to_edge(arrow)
        if edge is not None:
            edges.append(edge)

    return {
        "nodes": file_nodes + text_nodes,
        "edges": edges,
    }


def main() -> int:
    if not BLOCKS_FILE.is_file():
        print(f"missing {BLOCKS_FILE}", file=sys.stderr)
        return 1
    if not HOTSPOTS_FILE.is_file():
        print(f"missing {HOTSPOTS_FILE}", file=sys.stderr)
        return 1
    if not ARROWS_FILE.is_file():
        print(f"missing {ARROWS_FILE}", file=sys.stderr)
        return 1

    canvas = build_canvas()
    OUTPUT_FILE.write_text(
        json.dumps(canvas, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    n_file = sum(1 for n in canvas["nodes"] if n["type"] == "file")
    n_text = sum(1 for n in canvas["nodes"] if n["type"] == "text")
    print(f"wrote {OUTPUT_FILE.relative_to(REPO)}")
    print(f"nodes: {len(canvas['nodes'])} ({n_file} file, {n_text} text)")
    print(f"edges: {len(canvas['edges'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
