"""Run the look-test scene through layout + writer + previews."""

from __future__ import annotations

import argparse
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from ..catalogue import load_catalogue, repo_root
from ..io.chunk_writer import write_world
from ..io.format import chunk_filename
from ..layout import layout_tile, verify_layout
from ..layout.records import Records, concat_records
from ..preview import render_chunk_iso, render_preview
from .scene import CX, CY, make_scene, scene_features

SOURCES = [{"name": "Hand-authored look test", "version": "1", "licence": "CC0-1.0"}]


@dataclass
class SceneStats:
    bricks: int
    layout_s_first: float  # includes numba JIT compile when the cache is cold
    layout_s_warm: float
    by_type: dict[str, int] = field(default_factory=dict)
    files: list[Path] = field(default_factory=list)


def lay_out_scene() -> tuple[Records, float, float]:
    """Lay out every chunk of the scene (each with its 1-cell rim and its own pieces).
    Returns the records and the layout time of the first chunk, cold and warm."""
    cv = make_scene()
    parts, first, warm = [], 0.0, 0.0
    for n in range(cv.ncx):
        color, feature, shape, I0, J0, placed = cv.chunk_view(n)
        t0 = time.perf_counter()
        rec = layout_tile(color, feature, shape, cv.k0, I0, J0, placed=placed)
        t1 = time.perf_counter()
        if n == 0:
            rec = layout_tile(color, feature, shape, cv.k0, I0, J0, placed=placed)
            first, warm = t1 - t0, time.perf_counter() - t1
        errs = verify_layout(color, feature, shape, rec, cv.k0, I0, J0, placed=placed)
        if errs:
            raise RuntimeError(f"look-test chunk {n} layout failed verification: " + "; ".join(errs))
        parts.append(rec)
    return concat_records(parts), first, warm


def build_testscene(out_dir: Path | str, *, generated: str | None = None) -> SceneStats:
    out = Path(out_dir)
    rec, first, warm = lay_out_scene()
    manifest = write_world(out, rec, scene_features(), SOURCES, generated=generated)
    top = render_preview(out)
    iso = render_chunk_iso(out / "chunks" / chunk_filename(CX, CY), out / "preview_iso.png", scale=8)
    iso2 = render_chunk_iso(out / "chunks" / chunk_filename(CX + 1, CY), out / "preview_iso_row.png", scale=8)
    cat = load_catalogue()
    by_type = Counter(cat[int(t)].name for t in rec["type"])
    return SceneStats(len(rec), first, warm, dict(sorted(by_type.items())), [manifest, top, iso, iso2])


def testscene_main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Build the hand-authored look-test world (1 chunk).")
    ap.add_argument("--out", type=Path, default=repo_root() / "build" / "testscene")
    args = ap.parse_args(argv)
    st = build_testscene(args.out)
    print(f"look-test chunks c_{CX:02d}_{CY:02d} + c_{CX + 1:02d}_{CY:02d}: {st.bricks} bricks; layout "
          f"{st.layout_s_first:.2f} s (first call) / {st.layout_s_warm:.3f} s (warm)")
    for name, n in st.by_type.items():
        print(f"  {name:22s} {n}")
    for f in st.files:
        print(f"wrote {f}")
