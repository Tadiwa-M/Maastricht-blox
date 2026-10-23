"""``blox`` command line: ``blox fetch`` downloads sources, ``blox build`` makes the world."""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np

from . import geo
from .geo import RDBox

log = logging.getLogger("blox")


def _bbox(text: str | None) -> RDBox:
    box = geo.slice_box() if text is None else RDBox.parse(text)
    clipped = box.intersect(geo.slice_box())
    if clipped.xmax <= clipped.xmin or clipped.ymax <= clipped.ymin:
        raise SystemExit(f"bbox {box.as_tuple()} does not overlap the slice {geo.slice_box().as_tuple()}")
    return clipped


# ---------------------------------------------------------------------------- fetch
def cmd_fetch(args: argparse.Namespace) -> int:
    from .sources import fetch_all

    only = tuple(s.strip() for s in args.only.split(",")) if args.only else ("ahn", "bag3d", "osm")
    root = Path(args.data_dir) if args.data_dir else None
    bbox = _bbox(args.bbox)
    log.info("fetching %s for RD bbox %s", ",".join(only), bbox.as_tuple())
    fetch_all(bbox, only=only, root=root)
    log.info("done")
    return 0


# ---------------------------------------------------------------------------- build
class MissingStage(RuntimeError):
    pass


def _import_stages() -> tuple[Callable[..., Any], Callable[..., Any], Callable[..., Any] | None]:
    """B2's layout / chunk writer / preview. Missing modules give a clear error."""
    try:
        from .layout import layout_tile  # type: ignore[attr-defined]
    except ImportError as exc:
        raise MissingStage(f"brick layout stage unavailable (blox_pipeline.layout.layout_tile): {exc}") from exc
    try:
        from .io.chunk_writer import write_world  # type: ignore[import-not-found]
    except ImportError as exc:
        raise MissingStage(f"chunk writer unavailable (blox_pipeline.io.chunk_writer.write_world): {exc}") from exc
    try:
        from .preview import render_preview  # type: ignore[attr-defined]
    except ImportError:
        render_preview = None
    return layout_tile, write_world, render_preview


def call_layout(layout_tile: Callable[..., Any], tile: Any) -> Any:
    """``layout_tile(color, feature, shape, k0, I0, J0, border=1, placed=...)``; the tile's
    1-cell rim is context for hollow culling only. ``placed`` (facade pieces, CONTRACT 7) is
    passed only when the tile has any."""
    if tile.dims[2] == 0:
        return None
    extra = {"placed": tile.placed} if getattr(tile, "placed", None) is not None and len(tile.placed) else {}
    return layout_tile(tile.color, tile.feature, tile.shape, tile.k0, tile.I0, tile.J0, border=1, **extra)


def own_chunk(records: Any, cx: int, cy: int) -> Any:
    """Keep only records whose position lies in chunk ``(cx, cy)`` (drops border bricks)."""
    if isinstance(records, np.ndarray) and records.dtype.names and "I" in records.dtype.names:
        keep = (records["I"] // geo.CHUNK_STUDS == cx) & (records["J"] // geo.CHUNK_STUDS == cy)
        return records[keep]
    return records


def _count(records: Any) -> int:
    try:
        return len(records)
    except TypeError:
        return 0


def log_facade_stats(world_runs: list, island_runs: list) -> None:
    """Facade detail share on the world grid, on islands, and overall (the number to watch)."""
    from .voxelise.facade_runs import facade_stats

    for label, runs in (("world grid", world_runs), ("islands", island_runs), ("total", world_runs + island_runs)):
        if not runs:
            continue
        fs = facade_stats(runs)
        log.info("facade detail (%s): %d/%d runs, %.0f%% of %d studs of exterior wall (fallback studs: %s)",
                 label, fs.detailed, fs.runs, 100 * fs.share, fs.length, fs.by_reason)


def cmd_build(args: argparse.Namespace) -> int:
    from .sources import ORTHO_CREDIT, SOURCE_CREDITS, load_all
    from .voxelise import VoxelConfig, build_features, iter_chunk_tiles, prepare_world

    try:
        layout_tile, write_world, render_preview = _import_stages()
    except MissingStage as exc:
        print(f"blox build: {exc}", file=sys.stderr)
        return 2
    bbox = _bbox(args.bbox)
    cells = geo.rd_box_to_cells(bbox)
    chunks = list(cells.chunks())
    load_box = RDBox(
        geo.X0 + min(c[0] for c in chunks) * geo.CHUNK_STUDS * geo.STUD_M,
        geo.Y0 + min(c[1] for c in chunks) * geo.CHUNK_STUDS * geo.STUD_M,
        geo.X0 + (max(c[0] for c in chunks) + 1) * geo.CHUNK_STUDS * geo.STUD_M,
        geo.Y0 + (max(c[1] for c in chunks) + 1) * geo.CHUNK_STUDS * geo.STUD_M,
    ).buffer(16.0).intersect(geo.slice_box())
    root = Path(args.data_dir) if args.data_dir else None
    t0 = time.time()
    src = load_all(load_box, root)
    log.info("loaded %d buildings, %d roads in %.1fs", len(src.buildings), len(src.osm.roads), time.time() - t0)
    cfg = VoxelConfig(maas_level_m=args.maas_level, use_ortho_ground=not args.no_ortho,
                      facade_detail=not args.no_facades, islands=not args.no_islands)
    world = prepare_world(src, cfg)
    from .islands import build_islands

    islands, island_runs = build_islands(world, set(chunks), layout_tile)
    log.info("islands: %d groups (%d buildings) turned off the grid -> %d island files, %d bricks",
             len(world.islands), sum(len(g.members) for g in world.islands), len(islands),
             sum(len(i.records) for i in islands))
    log_facade_stats(world.facades, island_runs)
    out: dict[tuple[int, int], Any] = {}
    for n, (cx, cy, tile) in enumerate(iter_chunk_tiles(world, cells), 1):
        recs = own_chunk(call_layout(layout_tile, tile), cx, cy)
        if _count(recs):
            out[(cx, cy)] = recs
        if n % 64 == 0:
            log.info("%d/%d chunks", n, len(chunks))
    sources = list(SOURCE_CREDITS) + ([ORTHO_CREDIT] if src.ortho is not None and not args.no_ortho else [])
    out_dir = Path(args.out)
    write_world(out_dir, out, build_features(world.registry), sources, islands=islands)
    if render_preview is not None and not args.no_preview:
        render_preview(out_dir)
    log.info("wrote %d chunks, %d islands, %d features to %s in %.1fs", len(out), len(islands),
             len(world.registry), out_dir, time.time() - t0)
    return 0


# ---------------------------------------------------------------------------- main
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="blox", description="Maastricht Blox data pipeline")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="command", required=True)
    bbox_help = "RD bbox xmin,ymin,xmax,ymax (default: the whole slice)"

    f = sub.add_parser("fetch", help="download AHN, 3D BAG, OSM (and optionally ortho) into data/raw")
    f.add_argument("--bbox", help=bbox_help)
    f.add_argument("--only", help="comma list of ahn,bag3d,osm,ortho,gtfs (default ahn,bag3d,osm)")
    f.add_argument("--data-dir", help="cache dir (default <repo>/data/raw or $BLOX_DATA_DIR)")
    f.set_defaults(func=cmd_fetch)

    b = sub.add_parser("build", help="voxelise + lay out bricks + write chunks")
    b.add_argument("--bbox", help=bbox_help)
    b.add_argument("--out", default="build/world")
    b.add_argument("--data-dir")
    b.add_argument("--maas-level", type=float, default=44.1, help="Maas water level, m NAP")
    b.add_argument("--no-ortho", action="store_true", help="ignore the aerial photo for ground colours")
    b.add_argument("--no-preview", action="store_true")
    b.add_argument("--no-facades", action="store_true", help="plain glass-cell windows, no facade grammar")
    b.add_argument("--no-islands", action="store_true",
                   help="keep rotated buildings on the world grid (staircase walls, CONTRACT v2 behaviour)")
    b.set_defaults(func=cmd_build)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    from .sources.http import DownloadError

    try:
        return int(args.func(args))
    except (DownloadError, FileNotFoundError) as exc:
        print(f"blox {args.command}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
