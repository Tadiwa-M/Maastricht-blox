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
from ..layout.records import Records
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
    cv = make_scene()
    placed = cv.placed_records()
    t0 = time.perf_counter()
    rec = layout_tile(cv.color, cv.feature, cv.shape, cv.k0, cv.I0, cv.J0, placed=placed)
    t1 = time.perf_counter()
    rec = layout_tile(cv.color, cv.feature, cv.shape, cv.k0, cv.I0, cv.J0, placed=placed)
    t2 = time.perf_counter()
    errs = verify_layout(cv.color, cv.feature, cv.shape, rec, cv.k0, cv.I0, cv.J0, placed=placed)
    if errs:
        raise RuntimeError("look-test layout failed verification: " + "; ".join(errs))
    return rec, t1 - t0, t2 - t1


def build_testscene(out_dir: Path | str, *, generated: str | None = None) -> SceneStats:
    out = Path(out_dir)
    rec, first, warm = lay_out_scene()
    manifest = write_world(out, rec, scene_features(), SOURCES, generated=generated)
    top = render_preview(out)
    iso = render_chunk_iso(out / "chunks" / chunk_filename(CX, CY), out / "preview_iso.png", scale=8)
    cat = load_catalogue()
    by_type = Counter(cat[int(t)].name for t in rec["type"])
    return SceneStats(len(rec), first, warm, dict(sorted(by_type.items())), [manifest, top, iso])


def testscene_main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Build the hand-authored look-test world (1 chunk).")
    ap.add_argument("--out", type=Path, default=repo_root() / "build" / "testscene")
    args = ap.parse_args(argv)
    st = build_testscene(args.out)
    print(f"look-test chunk c_{CX:02d}_{CY:02d}: {st.bricks} bricks; layout "
          f"{st.layout_s_first:.2f} s (first call) / {st.layout_s_warm:.3f} s (warm)")
    for name, n in st.by_type.items():
        print(f"  {name:22s} {n}")
    for f in st.files:
        print(f"wrote {f}")
