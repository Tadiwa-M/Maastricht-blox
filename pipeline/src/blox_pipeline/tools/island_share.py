"""Estimate how many buildings of an already built world would become islands.

``python -m blox_pipeline.tools.island_share <world_dir>``

Meant for worlds built before islands existed (e.g. ``samples/markt``, whose source data is
not in the repo). Footprints are not stored in a world, so each building's footprint is
rebuilt from its bricks: the union of the stud columns that carry its feature id. That
outline is a staircase, so it is simplified (Douglas-Peucker, ``SIMPLIFY_M``) back into
straight walls before measuring its yaw with the same estimator the pipeline uses
(``islands.orient``) and grouping with the same rules (``islands.group``). Buildings cut by
the edge of the world's chunks are skipped (their cut edge would read as an axis-aligned
wall). The answer is an estimate: a raster loses about half a stud of precision, so yaws
within ~1 deg of the 3 deg limit can land either way.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from shapely.geometry import box as shp_box
from shapely.ops import unary_union

from .. import geo
from ..catalogue import load_catalogue
from ..io.chunk_reader import read_manifest, read_world_records
from ..islands.group import MIN_YAW_DEG, plan_islands
from ..islands.orient import footprint_yaw
from ..preview.cells import footprint_cells
from ..voxelise.world import PreparedBuilding

SIMPLIFY_M = 0.8
MIN_AREA_M2 = 12.0


@dataclass
class ShareReport:
    buildings: int
    islands: int            # buildings that would be islands
    groups: int             # island groups (terraces count once)
    yaws: dict[int, float]  # feature id -> estimated yaw

    @property
    def share(self) -> float:
        return self.islands / self.buildings if self.buildings else 0.0


def building_footprints(world_dir: Path | str) -> dict[int, object]:
    """Feature id -> footprint polygon (RD metres) rebuilt from brick columns."""
    world = Path(world_dir)
    cat = load_catalogue()
    feats = json.loads((world / "features.json").read_text(encoding="utf-8"))["features"]
    kinds = {f["id"]: f for f in feats if f["kind"] in ("building", "landmark")}
    chunks = read_manifest(world)["chunks"]
    have = {(c["cx"], c["cy"]) for c in chunks}
    cells: dict[int, set[tuple[int, int]]] = {}
    for _, data in read_world_records(world):
        rec = data.records[np.isin(data.records["featureId"], list(kinds))]
        if not len(rec):
            continue
        c = footprint_cells(rec, cat)
        sizes = _sizes(rec, cat)
        owner = np.repeat(rec["featureId"], sizes)
        for f, I, J in zip(owner.tolist(), c.I.tolist(), c.J.tolist()):
            cells.setdefault(f, set()).add((I, J))
    out = {}
    s = geo.STUD_M
    for f, cs in cells.items():
        i0, j0, i1, j1 = kinds[f]["bboxIJ"]
        if not all((cx, cy) in have for cx in range(i0 // 64, i1 // 64 + 1) for cy in range(j0 // 64, j1 // 64 + 1)):
            continue  # cut by the edge of the sample
        poly = unary_union([shp_box(geo.X0 + I * s, geo.Y0 + J * s, geo.X0 + (I + 1) * s, geo.Y0 + (J + 1) * s)
                            for I, J in cs])
        if poly.geom_type == "MultiPolygon":
            poly = max(poly.geoms, key=lambda p: p.area)
        poly = poly.simplify(SIMPLIFY_M)
        if poly.area >= MIN_AREA_M2:
            out[f] = poly
    return out


def _sizes(rec, cat) -> np.ndarray:
    ei, ej, _ = cat.extent_tables()
    t, rot = rec["type"].astype(np.int64), rec["rot"].astype(np.int64) & 3
    return (ei[t, rot] * ej[t, rot]).astype(np.int64)


def island_share(world_dir: Path | str, min_yaw: float = MIN_YAW_DEG) -> ShareReport:
    fps = building_footprints(world_dir)
    blds = [PreparedBuilding(feature_id=f, bag_id=str(f), footprint=fp, roofs=[], wall=0, roof_pitched=0,
                             roof_flat=0, window_period=0, window_offset=0) for f, fp in sorted(fps.items())]
    groups, _ = plan_islands(blds, min_yaw)
    return ShareReport(len(blds), sum(len(g.members) for g in groups), len(groups),
                       {b.feature_id: footprint_yaw(b.footprint)[0] for b in blds})


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("world", type=Path)
    args = ap.parse_args(argv)
    r = island_share(args.world)
    yaws = np.abs(np.array(list(r.yaws.values()))) if r.yaws else np.zeros(0)
    print(f"{r.buildings} whole buildings; {r.islands} ({100 * r.share:.0f}%) would be islands "
          f"in {r.groups} groups; |yaw| median {np.median(yaws) if len(yaws) else 0:.1f} deg")


if __name__ == "__main__":
    main()
