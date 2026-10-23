"""CityJSON (v1.1/2.0) reader for 3D BAG data.

Accepts a full CityJSON document, a single CityJSONFeature (+ transform), an OGC API
Features page as served by ``api.3dbag.nl`` (``metadata`` + ``features``), or a
CityJSONSeq (``.city.jsonl``) file. Buildings are returned with all BuildingPart
geometry merged at the best available LoD.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable, Iterator

import numpy as np

from .model import Building, Surface

LOD_PREFERENCE = ("2.2", "2.1", "2", "1.3", "1.2", "1.1", "1", "0")
_SEMANTIC_KIND = {
    "RoofSurface": "roof",
    "WallSurface": "wall",
    "GroundSurface": "ground",
    "OuterCeilingSurface": "roof",
    "OuterFloorSurface": "ground",
}


def read_path(path: Path) -> list[Building]:
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".jsonl" or path.name.endswith(".city.jsonl"):
        return list(parse_seq(text.splitlines()))
    return parse_document(json.loads(text))


def parse_seq(lines: Iterable[str]) -> Iterator[Building]:
    transform: dict[str, Any] | None = None
    for line in lines:
        line = line.strip()
        if not line:
            continue
        doc = json.loads(line)
        if doc.get("type") == "CityJSON":
            transform = doc.get("transform")
            continue
        yield from parse_feature(doc, transform)


def parse_document(doc: dict[str, Any]) -> list[Building]:
    if "features" in doc:  # OGC API page
        transform = (doc.get("metadata") or {}).get("transform")
        out: list[Building] = []
        for feat in doc["features"]:
            out.extend(parse_feature(feat, feat.get("transform") or transform))
        return out
    return list(parse_feature(doc, doc.get("transform")))


def parse_feature(doc: dict[str, Any], transform: dict[str, Any] | None) -> Iterator[Building]:
    verts = _vertices(doc.get("vertices", []), transform)
    objects: dict[str, Any] = doc.get("CityObjects", {})
    for oid, obj in objects.items():
        if obj.get("type") != "Building":
            continue
        parts = [objects[c] for c in obj.get("children", []) if c in objects] or [obj]
        lod, surfaces = _best_surfaces(parts, verts)
        attrs = dict(obj.get("attributes") or {})
        attrs.setdefault("identificatie", oid)
        yield Building(bag_id=str(attrs.get("identificatie", oid)), attributes=attrs, lod=lod, surfaces=surfaces)


def _vertices(raw: list[list[float]], transform: dict[str, Any] | None) -> np.ndarray:
    v = np.asarray(raw, dtype=np.float64).reshape(-1, 3)
    if transform:
        v = v * np.asarray(transform["scale"], float) + np.asarray(transform["translate"], float)
    return v


def _best_surfaces(parts: list[dict[str, Any]], verts: np.ndarray) -> tuple[str, list[Surface]]:
    available = {str(g.get("lod")) for p in parts for g in p.get("geometry", [])}
    for lod in LOD_PREFERENCE:
        if lod not in available:
            continue
        surfaces: list[Surface] = []
        for p in parts:
            for g in p.get("geometry", []):
                if str(g.get("lod")) == lod:
                    surfaces.extend(_geometry_surfaces(g, verts))
        return lod, surfaces
    return "", []


def _geometry_surfaces(geom: dict[str, Any], verts: np.ndarray) -> Iterator[Surface]:
    gtype = geom.get("type")
    sem = geom.get("semantics") or {}
    sem_surfaces = sem.get("surfaces", [])
    values = sem.get("values")
    if gtype in ("Solid",):
        shells = geom["boundaries"]
        for si, shell in enumerate(shells):
            shell_vals = values[si] if values else None
            yield from _surfaces(shell, shell_vals, sem_surfaces, verts)
    elif gtype in ("MultiSolid", "CompositeSolid"):
        for oi, solid in enumerate(geom["boundaries"]):
            for si, shell in enumerate(solid):
                vals = values[oi][si] if values else None
                yield from _surfaces(shell, vals, sem_surfaces, verts)
    elif gtype in ("MultiSurface", "CompositeSurface"):
        yield from _surfaces(geom["boundaries"], values, sem_surfaces, verts)


def _surfaces(polys: list, vals: list | None, sem_surfaces: list, verts: np.ndarray) -> Iterator[Surface]:
    for pi, rings in enumerate(polys):
        if not rings:
            continue
        kind = "other"
        if vals is not None and pi < len(vals) and vals[pi] is not None:
            kind = _SEMANTIC_KIND.get(sem_surfaces[vals[pi]].get("type", ""), "other")
        ext = verts[np.asarray(rings[0], dtype=np.int64)]
        holes = [verts[np.asarray(r, dtype=np.int64)] for r in rings[1:]]
        if kind == "other":
            kind = _classify_by_normal(ext)
        yield Surface(kind=kind, exterior=ext, holes=holes)


def newell_normal(ring: np.ndarray) -> np.ndarray:
    """Unit normal of a 3D ring (Newell's method); zero vector if degenerate."""
    nxt = np.roll(ring, -1, axis=0)
    n = np.array([
        np.sum((ring[:, 1] - nxt[:, 1]) * (ring[:, 2] + nxt[:, 2])),
        np.sum((ring[:, 2] - nxt[:, 2]) * (ring[:, 0] + nxt[:, 0])),
        np.sum((ring[:, 0] - nxt[:, 0]) * (ring[:, 1] + nxt[:, 1])),
    ])
    norm = np.linalg.norm(n)
    return n / norm if norm > 0 else n


def _classify_by_normal(ring: np.ndarray) -> str:
    """Fallback when a surface has no semantics (outward-facing rings assumed)."""
    nz = newell_normal(ring)[2]
    if nz > 0.1:
        return "roof"
    if nz < -0.9:
        return "ground"
    return "wall"
