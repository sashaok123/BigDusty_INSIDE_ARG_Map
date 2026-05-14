"""Remove the hand-drawn connector arrows from arg_graph.png so the next
block-extraction pass produces fine-grained components. Uses a pure-Pillow
morphological tophat: closing fills thin dark strokes, the difference of
original-vs-closed isolates them. A connected-component pass restricts the
mask to elongated, small structures so dense glyph interiors survive."""

from __future__ import annotations

import time
from collections import Counter, deque
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC_IMAGE = ROOT / "arg_graph.png"
DST_IMAGE = ROOT / "arg_graph_clean.png"

THRESH_DARK = 180
CLOSING_DOWNSAMPLE = 2
CLOSING_KERNEL_SMALL = 13
DILATE_MASK_KERNEL = 5
COMPONENT_MAX_AREA = 8000
COMPONENT_MIN_ASPECT = 3.0


def measure_background(img: Image.Image) -> tuple[int, int, int]:
    w, h = img.size
    samples = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    pixels = []
    rgb = img.convert("RGB")
    px = rgb.load()
    for x, y in samples:
        pixels.append(px[x, y])
    counter = Counter(pixels)
    most_common, _ = counter.most_common(1)[0]
    return most_common


def closing(mask: Image.Image, kernel: int, downsample: int) -> Image.Image:
    w, h = mask.size
    if downsample > 1:
        dw, dh = max(1, w // downsample), max(1, h // downsample)
        small = mask.resize((dw, dh), Image.NEAREST)
    else:
        small = mask
    closed = small.filter(ImageFilter.MaxFilter(kernel))
    closed = closed.filter(ImageFilter.MinFilter(kernel))
    if downsample > 1:
        closed = closed.resize((w, h), Image.NEAREST)
    return closed


def arrows_mask(original_dark: Image.Image, closed_dark: Image.Image) -> Image.Image:
    arrows = Image.new("L", original_dark.size)
    orig_bytes = original_dark.tobytes()
    closed_bytes = closed_dark.tobytes()
    out = bytearray(len(orig_bytes))
    for i, (o, c) in enumerate(zip(orig_bytes, closed_bytes)):
        if o and not c:
            out[i] = 255
    arrows.frombytes(bytes(out))
    return arrows


def label_components(
    mask_bytes: bytes,
    width: int,
    height: int,
) -> tuple[list[int], list[tuple[int, int, int, int, int]]]:
    labels = [0] * (width * height)
    comps: list[tuple[int, int, int, int, int]] = []
    next_id = 0
    for sy in range(height):
        row_off = sy * width
        for sx in range(width):
            idx = row_off + sx
            if labels[idx] or not mask_bytes[idx]:
                continue
            next_id += 1
            min_x = max_x = sx
            min_y = max_y = sy
            area = 0
            stack = deque()
            stack.append((sx, sy))
            labels[idx] = next_id
            while stack:
                x, y = stack.pop()
                area += 1
                if x < min_x:
                    min_x = x
                elif x > max_x:
                    max_x = x
                if y < min_y:
                    min_y = y
                elif y > max_y:
                    max_y = y
                if x > 0:
                    n = y * width + (x - 1)
                    if not labels[n] and mask_bytes[n]:
                        labels[n] = next_id
                        stack.append((x - 1, y))
                if x + 1 < width:
                    n = y * width + (x + 1)
                    if not labels[n] and mask_bytes[n]:
                        labels[n] = next_id
                        stack.append((x + 1, y))
                if y > 0:
                    n = (y - 1) * width + x
                    if not labels[n] and mask_bytes[n]:
                        labels[n] = next_id
                        stack.append((x, y - 1))
                if y + 1 < height:
                    n = (y + 1) * width + x
                    if not labels[n] and mask_bytes[n]:
                        labels[n] = next_id
                        stack.append((x, y + 1))
            comps.append((min_x, min_y, max_x, max_y, area))
    return labels, comps


def safe_component_set(
    comps: list[tuple[int, int, int, int, int]],
    max_area: int,
    min_aspect: float,
) -> set[int]:
    safe: set[int] = set()
    for cid, (x0, y0, x1, y1, area) in enumerate(comps, start=1):
        w = x1 - x0 + 1
        h = y1 - y0 + 1
        aspect = max(w, h) / max(1, min(w, h))
        if aspect >= min_aspect and area <= max_area:
            safe.add(cid)
    return safe


def restrict_to_arrow_components(
    arrows: Image.Image,
    dark_mask: Image.Image,
    max_area: int,
    min_aspect: float,
) -> Image.Image:
    width, height = arrows.size
    dark_bytes = dark_mask.tobytes()
    labels, comps = label_components(dark_bytes, width, height)
    safe_ids = safe_component_set(comps, max_area, min_aspect)
    arrow_bytes = arrows.tobytes()
    out = bytearray(len(arrow_bytes))
    for i, val in enumerate(arrow_bytes):
        if val and labels[i] in safe_ids:
            out[i] = 255
    restricted = Image.new("L", arrows.size)
    restricted.frombytes(bytes(out))
    return restricted


def dilate_mask(mask: Image.Image, kernel: int) -> Image.Image:
    return mask.filter(ImageFilter.MaxFilter(kernel))


def paint_with_background(
    src: Image.Image,
    mask: Image.Image,
    background: tuple[int, int, int],
) -> Image.Image:
    base = src.convert("RGB")
    fill = Image.new("RGB", base.size, background)
    cleaned = Image.composite(fill, base, mask)
    return cleaned


def count_set_pixels(mask: Image.Image) -> int:
    return sum(1 for b in mask.tobytes() if b)


def main() -> None:
    t0 = time.perf_counter()
    if not SRC_IMAGE.exists():
        raise SystemExit(f"missing source: {SRC_IMAGE}")
    src = Image.open(SRC_IMAGE)
    width, height = src.size
    total_px = width * height
    background = measure_background(src)
    print(f"measured background colour: {background}")

    gray = src.convert("L")
    dark = gray.point(lambda v: 255 if v < THRESH_DARK else 0, mode="L")

    closed = closing(dark, CLOSING_KERNEL_SMALL, CLOSING_DOWNSAMPLE)
    raw_arrows = arrows_mask(dark, closed)
    restricted = restrict_to_arrow_components(
        raw_arrows,
        dark,
        COMPONENT_MAX_AREA,
        COMPONENT_MIN_ASPECT,
    )
    dilated = dilate_mask(restricted, DILATE_MASK_KERNEL)

    repainted = count_set_pixels(dilated)
    cleaned = paint_with_background(src, dilated, background)
    cleaned.save(DST_IMAGE, "PNG")

    elapsed = time.perf_counter() - t0
    pct = (repainted / total_px) * 100
    print(
        f"Repainted {repainted} pixels of {total_px} total ({pct:.3f}%). "
        f"Wrote cleaned image to {DST_IMAGE}. Total elapsed {elapsed:.2f} s."
    )


if __name__ == "__main__":
    main()
