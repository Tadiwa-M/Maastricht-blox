"""Draw the desktop icons: an original isometric 2x2 brick on the game's night blue.

Usage (from pipeline/, for Pillow):  uv run python ../scripts/make_icon.py <out_dir>
Writes blox.ico (the web game, red brick) and blox_unity.ico (the Unity build, teal brick).
Original brick style only: no third-party logo or lettering on the studs.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

S = 1024  # drawn large, downscaled for crisp small sizes
BG = (11, 13, 42)  # theme_color of viewer/src/game.webmanifest


def shade(c: tuple[int, int, int], f: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, round(v * f))) for v in c)  # type: ignore[return-value]


def iso(x: float, y: float, z: float) -> tuple[float, float]:
    """Isometric projection: x to the right-down, y to the left-down, z up. Unit = one stud."""
    cx, cy, u = S * 0.5, S * 0.60, S * 0.135
    return (cx + (x - y) * u * 0.866, cy + (x + y) * u * 0.5 - z * u)


def brick(draw: ImageDraw.ImageDraw, color: tuple[int, int, int]) -> None:
    n, h = 3.0, 1.5  # a 3x3-stud plate-style brick reads best at icon size; height in studs
    top = [iso(-n / 2, -n / 2, h), iso(n / 2, -n / 2, h), iso(n / 2, n / 2, h), iso(-n / 2, n / 2, h)]
    right = [iso(n / 2, -n / 2, h), iso(n / 2, n / 2, h), iso(n / 2, n / 2, 0), iso(n / 2, -n / 2, 0)]
    left = [iso(-n / 2, n / 2, h), iso(n / 2, n / 2, h), iso(n / 2, n / 2, 0), iso(-n / 2, n / 2, 0)]
    edge = shade(color, 0.45)
    draw.polygon(right, fill=shade(color, 0.72), outline=edge, width=6)
    draw.polygon(left, fill=shade(color, 0.86), outline=edge, width=6)
    draw.polygon(top, fill=color, outline=edge, width=6)
    # studs, back to front so nearer ones overlap farther ones
    r, sh = 0.36, 0.35
    for sx, sy in sorted(((a, b) for a in (-1, 0, 1) for b in (-1, 0, 1)), key=lambda p: p[0] + p[1]):
        bx, by = iso(sx, sy, h)
        tx, ty = iso(sx, sy, h + sh)
        rx, ry = r * S * 0.135 * 1.22, r * S * 0.135 * 0.70
        draw.rectangle([bx - rx, ty, bx + rx, by], fill=shade(color, 0.80))
        draw.ellipse([bx - rx, by - ry, bx + rx, by + ry], fill=shade(color, 0.80), outline=edge, width=4)
        draw.ellipse([tx - rx, ty - ry, tx + rx, ty + ry], fill=shade(color, 1.12), outline=edge, width=4)
        draw.line([(bx - rx, ty), (bx - rx, by)], fill=edge, width=4)
        draw.line([(bx + rx, ty), (bx + rx, by)], fill=edge, width=4)


def icon(color: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([24, 24, S - 24, S - 24], radius=190, fill=BG)
    brick(d, color)
    return img


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)
    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    for name, color in (("blox", (196, 40, 34)), ("blox_unity", (24, 150, 160))):
        img = icon(color)
        img.resize((256, 256), Image.LANCZOS).save(out / f"{name}.png")
        img.save(out / f"{name}.ico", sizes=sizes)
        print(out / f"{name}.ico")


if __name__ == "__main__":
    main()
