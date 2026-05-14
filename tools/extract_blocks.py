"""Detect distinct content blocks on the arg_graph.png poster and crop each
one to data/blocks/block_NNN.webp with a JSON manifest. The poster has a
white background with darker content; the mask flags pixels below
BG_THRESHOLD as foreground. Flow: threshold -> downsampled dilate ->
flood-fill -> filter -> pad -> reading-order sort."""

from __future__ import annotations

import argparse
import json
import time
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC_IMAGE = ROOT / "arg_graph.png"
BLOCKS_DIR = ROOT / "data" / "blocks"
MANIFEST_PATH = ROOT / "data" / "blocks_raw.json"

BG_THRESHOLD = 230
DILATE_RADIUS = 12
DOWNSAMPLE = 4
MIN_AREA = 4000
MAX_AREA_FRAC = 0.5
PAD = 8
ROW_TOLERANCE = 100
WEBP_QUALITY = 90


def load_grayscale(path: Path) -> Image.Image:
    img = Image.open(path)
    if img.mode != "L":
        img = img.convert("L")
    return img


def build_mask(gray: Image.Image, bg_threshold: int) -> Image.Image:
    return gray.point(lambda v: 255 if v < bg_threshold else 0, mode="L")


def dilate_via_downsample(mask: Image.Image, radius: int, factor: int) -> Image.Image:
    w, h = mask.size
    dw, dh = max(1, w // factor), max(1, h // factor)
    small = mask.resize((dw, dh), Image.NEAREST)
    kernel_size = max(3, 2 * (radius // factor) + 1)
    if kernel_size % 2 == 0:
        kernel_size += 1
    dilated = small.filter(ImageFilter.MaxFilter(kernel_size))
    return dilated.resize((w, h), Image.NEAREST)


def flood_fill_components(
    mask_bytes: bytes,
    width: int,
    height: int,
) -> list[tuple[int, int, int, int]]:
    visited = bytearray(width * height)
    boxes: list[tuple[int, int, int, int]] = []
    for sy in range(height):
        row_off = sy * width
        for sx in range(width):
            idx = row_off + sx
            if visited[idx] or not mask_bytes[idx]:
                continue
            min_x = max_x = sx
            min_y = max_y = sy
            stack = deque()
            stack.append((sx, sy))
            visited[idx] = 1
            while stack:
                x, y = stack.pop()
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
                    if not visited[n] and mask_bytes[n]:
                        visited[n] = 1
                        stack.append((x - 1, y))
                if x + 1 < width:
                    n = y * width + (x + 1)
                    if not visited[n] and mask_bytes[n]:
                        visited[n] = 1
                        stack.append((x + 1, y))
                if y > 0:
                    n = (y - 1) * width + x
                    if not visited[n] and mask_bytes[n]:
                        visited[n] = 1
                        stack.append((x, y - 1))
                if y + 1 < height:
                    n = (y + 1) * width + x
                    if not visited[n] and mask_bytes[n]:
                        visited[n] = 1
                        stack.append((x, y + 1))
            boxes.append((min_x, min_y, max_x, max_y))
    return boxes


def filter_boxes(
    boxes: list[tuple[int, int, int, int]],
    width: int,
    height: int,
) -> list[tuple[int, int, int, int]]:
    img_area = width * height
    keep: list[tuple[int, int, int, int]] = []
    for x0, y0, x1, y1 in boxes:
        bw = x1 - x0 + 1
        bh = y1 - y0 + 1
        area = bw * bh
        if area < MIN_AREA:
            continue
        if area > img_area * MAX_AREA_FRAC:
            continue
        touches_left = x0 == 0
        touches_top = y0 == 0
        touches_right = x1 == width - 1
        touches_bottom = y1 == height - 1
        if touches_left and touches_top and touches_right and touches_bottom:
            continue
        keep.append((x0, y0, x1, y1))
    return keep


def pad_box(
    box: tuple[int, int, int, int],
    width: int,
    height: int,
    pad: int,
) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = box
    return (
        max(0, x0 - pad),
        max(0, y0 - pad),
        min(width - 1, x1 + pad),
        min(height - 1, y1 + pad),
    )


def reading_order_sort(
    boxes: list[tuple[int, int, int, int]],
    row_tolerance: int,
) -> list[tuple[int, int, int, int]]:
    sorted_by_y = sorted(boxes, key=lambda b: b[1])
    rows: list[list[tuple[int, int, int, int]]] = []
    for box in sorted_by_y:
        placed = False
        for row in rows:
            ref_y = min(b[1] for b in row)
            if abs(box[1] - ref_y) <= row_tolerance:
                row.append(box)
                placed = True
                break
        if not placed:
            rows.append([box])
    ordered: list[tuple[int, int, int, int]] = []
    rows.sort(key=lambda r: min(b[1] for b in r))
    for row in rows:
        row.sort(key=lambda b: b[0])
        ordered.extend(row)
    return ordered


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_SRC_IMAGE,
        help="path to source poster (default: arg_graph.png)",
    )
    args = parser.parse_args()
    src_image: Path = args.input

    t0 = time.perf_counter()
    if not src_image.exists():
        raise SystemExit(f"missing source: {src_image}")
    BLOCKS_DIR.mkdir(parents=True, exist_ok=True)
    for existing in BLOCKS_DIR.glob("block_*.webp"):
        existing.unlink()

    gray = load_grayscale(src_image)
    width, height = gray.size
    mask = build_mask(gray, BG_THRESHOLD)
    dilated = dilate_via_downsample(mask, DILATE_RADIUS, DOWNSAMPLE)

    dw, dh = max(1, width // DOWNSAMPLE), max(1, height // DOWNSAMPLE)
    small_dilated = dilated.resize((dw, dh), Image.NEAREST)
    mask_bytes = small_dilated.tobytes()

    raw_boxes = flood_fill_components(mask_bytes, dw, dh)
    pre_filter_count = len(raw_boxes)

    scaled: list[tuple[int, int, int, int]] = []
    for x0, y0, x1, y1 in raw_boxes:
        sx0 = x0 * DOWNSAMPLE
        sy0 = y0 * DOWNSAMPLE
        sx1 = min(width - 1, (x1 + 1) * DOWNSAMPLE - 1)
        sy1 = min(height - 1, (y1 + 1) * DOWNSAMPLE - 1)
        scaled.append((sx0, sy0, sx1, sy1))

    filtered = filter_boxes(scaled, width, height)
    padded = [pad_box(b, width, height, PAD) for b in filtered]
    ordered = reading_order_sort(padded, ROW_TOLERANCE)

    source = Image.open(src_image)
    blocks_records: list[dict[str, object]] = []
    smallest = None
    largest = None
    for idx, (x0, y0, x1, y1) in enumerate(ordered, start=1):
        bw = x1 - x0 + 1
        bh = y1 - y0 + 1
        if smallest is None or bw * bh < smallest[0] * smallest[1]:
            smallest = (bw, bh)
        if largest is None or bw * bh > largest[0] * largest[1]:
            largest = (bw, bh)
        crop = source.crop((x0, y0, x1 + 1, y1 + 1))
        if crop.mode == "RGBA":
            crop = crop.convert("RGB")
        name = f"block_{idx:03d}.webp"
        out_path = BLOCKS_DIR / name
        crop.save(out_path, "WEBP", quality=WEBP_QUALITY)
        blocks_records.append(
            {
                "id": f"block_{idx:03d}",
                "rect": {"x": int(x0), "y": int(y0), "w": int(bw), "h": int(bh)},
                "file": f"data/blocks/{name}",
            }
        )

    manifest = {
        "version": 1,
        "source_image_w": int(width),
        "source_image_h": int(height),
        "blocks": blocks_records,
    }
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    elapsed = time.perf_counter() - t0
    sm = smallest if smallest else (0, 0)
    lg = largest if largest else (0, 0)
    print(
        f"Detected {pre_filter_count} components before filter, "
        f"{len(ordered)} after filter. Smallest block {sm[0]}x{sm[1]}, "
        f"largest {lg[0]}x{lg[1]}. Wrote {len(blocks_records)} webps to "
        f"{BLOCKS_DIR} and manifest to {MANIFEST_PATH}. "
        f"Total elapsed {elapsed:.2f} s."
    )


if __name__ == "__main__":
    main()
