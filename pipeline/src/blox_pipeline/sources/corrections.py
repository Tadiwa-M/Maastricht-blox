"""Hand corrections to the source data (``corrections/corrections.json``), applied on every build.

Map reports (the in-game "Report a mistake" button -> GitHub issues) are mostly fixed here, as
small reviewable data edits, instead of in code. Coordinates are RD (EPSG:28992) metres, as each
report lists them. Kinds:

``remove_building``  ``{"bag": "<BAG id or osm-way/..>"}`` or ``{"at": [x, y]}`` (the building whose
                     footprint contains the point)
``set_height``       same selector plus ``"height_m"``: roof top this far above the ground
``add_building``     ``{"polygon": [[x, y], ...], "height_m": 9, "roof": "flat" | "gable",
                     "eave_m": 6}``: a building the sources lack (ground from AHN)
``osm_tags``         ``{"osm": "way/123", "set": {"bridge": "yes"}, "remove": ["tunnel"]}``

Every fix should carry ``"issue"`` (the GitHub issue number) and a short ``"note"``.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from shapely.geometry import Point, Polygon

from .bag3d import footprint
from .model import Building, HeightGrid, OsmData, Surface

log = logging.getLogger(__name__)

KINDS = ("remove_building", "set_height", "add_building", "osm_tags")


class CorrectionError(ValueError):
    pass


@dataclass
class Report:
    applied: list[str] = field(default_factory=list)
    unmatched: list[str] = field(default_factory=list)


def default_path() -> Path:
    return Path(__file__).resolve().parents[4] / "corrections" / "corrections.json"


def load_corrections(path: Path | None = None) -> list[dict[str, Any]]:
    """Read and validate the fixes; a missing file means no fixes."""
    p = path or default_path()
    if not p.exists():
        return []
    doc = json.loads(p.read_text(encoding="utf-8"))
    fixes = doc.get("fixes", [])
    for n, f in enumerate(fixes):
        check_fix(f, n)
    return fixes


def check_fix(f: dict[str, Any], n: int = 0) -> None:
    where = f"fix #{n} ({f.get('id', '?')})"
    kind = f.get("kind")
    if kind not in KINDS:
        raise CorrectionError(f"{where}: kind must be one of {KINDS}, not {kind!r}")
    if kind in ("remove_building", "set_height") and not (f.get("bag") or _pt(f.get("at"))):
        raise CorrectionError(f"{where}: needs \"bag\" or \"at\": [x, y] (RD metres)")
    if kind == "set_height" and not _pos(f.get("height_m")):
        raise CorrectionError(f"{where}: needs a positive \"height_m\"")
    if kind == "add_building":
        poly = f.get("polygon")
        if not (isinstance(poly, list) and len(poly) >= 3 and all(_pt(p) for p in poly)):
            raise CorrectionError(f"{where}: \"polygon\" must be 3+ [x, y] RD points")
        if not _pos(f.get("height_m")):
            raise CorrectionError(f"{where}: needs a positive \"height_m\"")
        if f.get("roof", "flat") not in ("flat", "gable"):
            raise CorrectionError(f"{where}: roof must be \"flat\" or \"gable\"")
    if kind == "osm_tags" and not (isinstance(f.get("osm"), str) and "/" in f["osm"]):
        raise CorrectionError(f"{where}: needs \"osm\": \"way/<id>\"")


def _pt(p: Any) -> bool:
    return isinstance(p, list) and len(p) == 2 and all(isinstance(v, (int, float)) for v in p)


def _pos(v: Any) -> bool:
    return isinstance(v, (int, float)) and v > 0


def _select(buildings: list[Building], f: dict[str, Any]) -> list[int]:
    if f.get("bag"):
        return [n for n, b in enumerate(buildings) if b.bag_id == f["bag"]]
    pt = Point(*f["at"])
    return [n for n, b in enumerate(buildings) if (fp := footprint(b)) is not None and fp.contains(pt)]


def _ground_at(dtm: HeightGrid, poly: Polygon) -> float:
    from .osm_buildings import _samples

    s = _samples(poly, dtm)
    if len(s) == 0:
        raise CorrectionError("add_building: no terrain under the polygon (outside the slice?)")
    return float(np.median(s))


def _with_height(b: Building, height: float) -> Building:
    ground = b.ground_z if b.ground_z is not None else min(float(s.exterior[:, 2].min()) for s in b.surfaces)
    top = b.roof_max_z or ground
    old = max(0.5, top - ground)
    k = height / old
    surfaces = []
    for s in b.surfaces:
        ext = s.exterior.copy()
        if s.kind == "roof":
            ext[:, 2] = ground + (ext[:, 2] - ground) * k
        surfaces.append(Surface(s.kind, ext, s.holes))
    attrs = dict(b.attributes, b3_h_dak_max=ground + height)
    return Building(b.bag_id, attrs, b.lod, surfaces)


def apply_corrections(fixes: list[dict[str, Any]], buildings: list[Building], osm: OsmData,
                      dtm: HeightGrid) -> tuple[list[Building], Report]:
    """Apply ``fixes`` to the loaded sources; returns the new building list and what happened."""
    from .osm_buildings import _gable, _ring3

    rep = Report()
    out = list(buildings)
    for n, f in enumerate(fixes):
        label = f"{f.get('id', n)} ({f['kind']}{', issue #' + str(f['issue']) if f.get('issue') else ''})"
        kind = f["kind"]
        if kind in ("remove_building", "set_height"):
            hit = _select(out, f)
            if not hit:
                rep.unmatched.append(label)
                continue
            if kind == "remove_building":
                out = [b for k, b in enumerate(out) if k not in set(hit)]
            else:
                for k in hit:
                    out[k] = _with_height(out[k], float(f["height_m"]))
        elif kind == "add_building":
            poly = Polygon(f["polygon"])
            if not poly.is_valid:
                poly = poly.buffer(0)
            ground = _ground_at(dtm, poly)
            ridge = ground + float(f["height_m"])
            eave = ground + float(f.get("eave_m", f["height_m"]))
            roofs = _gable(poly, eave, ridge) if f.get("roof") == "gable" and ridge > eave else None
            if roofs is None:
                roofs = [Surface("roof", _ring3(poly.exterior.coords, lambda x, y: ridge))]
            ground_srf = Surface("ground", _ring3(poly.exterior.coords, lambda x, y: ground))
            bid = f"fix-{f.get('id', n)}"
            out.append(Building(bid, {"b3_h_maaiveld": ground, "b3_h_dak_max": ridge, "source": "correction"},
                                "fix", roofs + [ground_srf]))
        elif kind == "osm_tags":
            found = False
            for lst in (osm.roads, osm.road_areas, osm.railways, osm.water, osm.waterways, osm.landuse,
                        osm.buildings, osm.pois):
                for feat in lst:
                    if feat.osm_id == f["osm"]:
                        feat.tags.update({k: str(v) for k, v in (f.get("set") or {}).items()})
                        for k in f.get("remove") or []:
                            feat.tags.pop(k, None)
                        found = True
            if not found:
                rep.unmatched.append(label)
                continue
        rep.applied.append(label)
    if fixes:
        log.info("corrections: %d applied, %d matched nothing%s", len(rep.applied), len(rep.unmatched),
                 f" ({', '.join(rep.unmatched)})" if rep.unmatched else "")
    return out, rep


__all__ = ["CorrectionError", "KINDS", "apply_corrections", "check_fix", "load_corrections"]
