"""Lay out every block_NNN.webp from data/blocks/ into a grid contact sheet
for visual review. Each tile is downscaled to <= MAX_TILE_W px wide,
aspect-preserved, on a dark grey background, with the block id rendered in
the bottom-left corner. Saved to reports/contact_sheet_blocks.png next to
the workspace root, NOT inside the repo.
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parent.parent
WORKSPACE = REPO.parent
BLOCKS_DIR = REPO / "data" / "blocks"
ANNOTATION_FILE = WORKSPACE / "arg_graph_blocks.json"
OUTPUT_PATH = WORKSPACE / "reports" / "contact_sheet_blocks.png"

COLS = 12
MAX_TILE_W = 240
MAX_TILE_H = 200
TILE_PAD = 12
SHEET_MARGIN = 24
BG_RGB = (28, 30, 36)
TILE_BG_RGB = (40, 44, 52)
LABEL_BG_RGB = (16, 18, 22)
LABEL_FG_RGB = (232, 232, 236)
FONT_CANDIDATES = (
    "C:/Windows/Fonts/seguisb.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/consola.ttf",
    "C:/Windows/Fonts/arial.ttf",
)


def load_font(size: int) -> ImageFont.ImageFont:
    for candidate in FONT_CANDIDATES:
        path = Path(candidate)
        if path.is_file():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def fit_inside(src_w: int, src_h: int, max_w: int, max_h: int) -> tuple[int, int]:
    if src_w <= 0 or src_h <= 0:
        return (1, 1)
    scale = min(max_w / src_w, max_h / src_h, 1.0)
    w = max(1, int(round(src_w * scale)))
    h = max(1, int(round(src_h * scale)))
    return (w, h)


def collect_block_ids() -> list[str]:
    if ANNOTATION_FILE.is_file():
        data = json.loads(ANNOTATION_FILE.read_text(encoding="utf-8"))
        return [b["id"] for b in data.get("blocks", []) if isinstance(b, dict)]
    return sorted(p.stem for p in BLOCKS_DIR.glob("block_*.webp"))


def render_tile(
    img: Image.Image,
    cell_w: int,
    cell_h: int,
    label: str,
    font: ImageFont.ImageFont,
) -> Image.Image:
    inner_w = cell_w - 2 * TILE_PAD
    inner_h = cell_h - 2 * TILE_PAD
    fit_w, fit_h = fit_inside(img.width, img.height, inner_w, inner_h)
    thumb = img.resize((fit_w, fit_h), Image.LANCZOS)
    tile = Image.new("RGB", (cell_w, cell_h), TILE_BG_RGB)
    ox = TILE_PAD + (inner_w - fit_w) // 2
    oy = TILE_PAD + (inner_h - fit_h) // 2
    tile.paste(thumb, (ox, oy))
    draw = ImageDraw.Draw(tile)
    bbox = draw.textbbox((0, 0), label, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    pad_x = 6
    pad_y = 3
    badge_w = text_w + pad_x * 2
    badge_h = text_h + pad_y * 2
    bx = TILE_PAD
    by = cell_h - TILE_PAD - badge_h
    draw.rectangle([(bx, by), (bx + badge_w, by + badge_h)], fill=LABEL_BG_RGB)
    draw.text((bx + pad_x - bbox[0], by + pad_y - bbox[1]), label, font=font, fill=LABEL_FG_RGB)
    return tile


def build_sheet(block_ids: list[str]) -> Image.Image:
    n = len(block_ids)
    cols = min(COLS, max(1, n))
    rows = (n + cols - 1) // cols
    cell_w = MAX_TILE_W + 2 * TILE_PAD
    cell_h = MAX_TILE_H + 2 * TILE_PAD
    sheet_w = SHEET_MARGIN * 2 + cols * cell_w
    sheet_h = SHEET_MARGIN * 2 + rows * cell_h
    sheet = Image.new("RGB", (sheet_w, sheet_h), BG_RGB)
    font = load_font(18)
    for i, bid in enumerate(block_ids):
        path = BLOCKS_DIR / f"{bid}.webp"
        if not path.is_file():
            continue
        with Image.open(path) as raw:
            img = raw.convert("RGB")
        tile = render_tile(img, cell_w, cell_h, bid, font)
        col = i % cols
        row = i // cols
        x = SHEET_MARGIN + col * cell_w
        y = SHEET_MARGIN + row * cell_h
        sheet.paste(tile, (x, y))
    return sheet


def main() -> int:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    block_ids = collect_block_ids()
    if not block_ids:
        print("no blocks to render")
        return 1
    sheet = build_sheet(block_ids)
    sheet.save(OUTPUT_PATH, "PNG", optimize=True)
    size_bytes = OUTPUT_PATH.stat().st_size
    print(f"wrote {OUTPUT_PATH}")
    print(f"dimensions: {sheet.width}x{sheet.height}")
    print(f"bytes: {size_bytes}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
