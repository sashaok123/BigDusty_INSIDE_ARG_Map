"""Merge block descriptions into canvas.canvas nodes.
Reads data/block_descriptions_full.json and writes per-node `text` + `summary`
into matching nodes in data/canvas.canvas. Also flips kind=text/mixed nodes to
JSON Canvas type='text' (so the side panel renders them as cards) and keeps
kind=image nodes as type='file'. Idempotent.
"""
from __future__ import annotations
import json
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent
DESC = REPO / "data" / "block_descriptions_full.json"
CANVAS = REPO / "data" / "canvas.canvas"


def main() -> None:
    desc = json.loads(DESC.read_text(encoding="utf-8"))
    canvas = json.loads(CANVAS.read_text(encoding="utf-8"))
    by_id = {e["id"]: e for e in desc["entries"]}
    text_count = image_count = empty_count = mixed_count = unmatched = 0
    for node in canvas["nodes"]:
        nid = node.get("id")
        entry = by_id.get(nid)
        if entry is None:
            unmatched += 1
            continue
        kind = entry.get("kind", "image")
        text = (entry.get("text") or "").strip()
        summary = (entry.get("summary") or "").strip()
        node["summary"] = summary
        node["content_kind"] = kind
        if kind == "text" and text:
            node["text"] = text
            text_count += 1
        elif kind == "mixed":
            if text:
                node["text"] = text
            mixed_count += 1
        elif kind == "image":
            image_count += 1
        elif kind == "empty":
            empty_count += 1
    CANVAS.write_text(json.dumps(canvas, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"nodes updated: text={text_count} mixed={mixed_count} image={image_count} empty={empty_count} unmatched={unmatched}")


if __name__ == "__main__":
    main()
