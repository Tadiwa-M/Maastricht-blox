"""Feature registry and ``features.json`` content (CONTRACT.md section 6)."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from shapely.geometry.base import BaseGeometry

from .. import geo

KINDS = frozenset({"building", "landmark", "poi", "street", "water", "park", "station", "stop"})


@dataclass
class Feature:
    id: int
    kind: str
    name: str | None = None
    bag_id: str | None = None
    osm_id: str | None = None
    address: str | None = None
    year: int | None = None
    height_m: float | None = None
    centroid: tuple[int, int] | None = None
    bbox_ij: tuple[int, int, int, int] | None = None
    tags: dict[str, str] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        d: dict[str, Any] = {"id": self.id, "kind": self.kind}
        for key, val in (("name", self.name), ("bagId", self.bag_id), ("osmId", self.osm_id),
                         ("address", self.address), ("year", self.year)):
            if val is not None:
                d[key] = val
        if self.height_m is not None:
            d["heightM"] = round(self.height_m, 1)
        if self.centroid is not None:
            d["centroid"] = list(self.centroid)
        if self.bbox_ij is not None:
            d["bboxIJ"] = list(self.bbox_ij)
        if self.tags:
            d["tags"] = dict(self.tags)
        return d


class FeatureRegistry:
    """Hands out feature ids (1, 2, ...) in registration order. Register in a
    deterministic order (e.g. sorted BAG ids) so ids are stable between runs."""

    def __init__(self) -> None:
        self._items: list[Feature] = []
        self._by_key: dict[tuple[str, str], int] = {}

    def add(self, kind: str, geom: BaseGeometry | None = None, key: str | None = None, **fields: Any) -> int:
        """Register a feature; with ``key``, re-registering the same ``(kind, key)``
        returns the existing id and grows its extent to include ``geom``."""
        if kind not in KINDS:
            raise ValueError(f"unknown feature kind {kind!r}")
        if key is not None and (kind, key) in self._by_key:
            fid = self._by_key[(kind, key)]
            if geom is not None:
                self._grow(self._items[fid - 1], geom)
            return fid
        fid = len(self._items) + 1
        feat = Feature(id=fid, kind=kind, **fields)
        if geom is not None:
            self._grow(feat, geom)
        self._items.append(feat)
        if key is not None:
            self._by_key[(kind, key)] = fid
        return fid

    def get(self, fid: int) -> Feature:
        return self._items[fid - 1]

    def __len__(self) -> int:
        return len(self._items)

    def __iter__(self):
        return iter(self._items)

    @staticmethod
    def _grow(feat: Feature, geom: BaseGeometry) -> None:
        xmin, ymin, xmax, ymax = geom.bounds
        i0, j0 = geo.rd_to_grid(xmin, ymin)
        # inclusive max cell: a max edge exactly on a cell boundary belongs to the cell below
        i1, j1 = geo.rd_to_grid(xmax - 1e-6, ymax - 1e-6)
        i1, j1 = max(i0, i1), max(j0, j1)
        if feat.bbox_ij is not None:
            a, b, c, d = feat.bbox_ij
            i0, j0, i1, j1 = min(a, i0), min(b, j0), max(c, i1), max(d, j1)
        feat.bbox_ij = (i0, j0, i1, j1)
        if feat.centroid is None:
            p = geom.representative_point() if geom.geom_type != "Point" else geom
            c = geom.centroid if geom.geom_type in ("Polygon", "MultiPolygon") and geom.centroid.within(geom) else p
            feat.centroid = (math.floor((c.x - geo.X0) / geo.STUD_M), math.floor((c.y - geo.Y0) / geo.STUD_M))


def build_features(registry: FeatureRegistry) -> dict[str, Any]:
    """The ``features.json`` document. ``bboxIJ`` is inclusive ``[I0, J0, I1, J1]``
    (global cells); ``centroid`` is a global cell ``[I, J]`` inside the feature."""
    return {"features": [f.to_json() for f in registry]}
