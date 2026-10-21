"""OpenStreetMap: Geofabrik Limburg extract, clipped to the slice with pyosmium."""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import osmium
import shapely
from shapely import box as shp_box
from shapely.geometry.base import BaseGeometry

from ..geo import RDBox, slice_box, wgs84_to_rd
from . import config
from .http import download, make_session
from .osm_classify import classify_area, classify_node, classify_way
from .model import OsmData, OsmFeature

log = logging.getLogger(__name__)


def source_path(root: Path | None = None) -> Path:
    return (root or config.data_dir()) / "osm" / config.OSM_PBF_URL.rsplit("/", 1)[-1]


def clip_path(root: Path | None = None) -> Path:
    """The clip always covers the whole slice (+ margin); sub-bboxes filter at load."""
    return (root or config.data_dir()) / "osm" / "slice_clip.osm.pbf"


def fetch_osm(root: Path | None = None) -> Path:
    """Download the Geofabrik extract (cached) and clip it to the slice + margin."""
    if not source_path(root).exists():
        log.info("OSM: downloading the Geofabrik Limburg extract (~100 MB, quiet for a few minutes; "
                 "an interrupted download resumes on the next run)")
    src = download(config.OSM_PBF_URL, source_path(root), session=make_session())
    dst = clip_path(root)
    if not dst.exists():
        log.info("OSM: clipping the extract to the slice (two passes over the file, a few minutes)")
        clip_pbf(src, dst, slice_box().buffer(config.OSM_CLIP_MARGIN_M).to_wgs84())
    return dst


def clip_pbf(src: Path, dst: Path, bbox_wgs84: tuple[float, float, float, float]) -> None:
    """Write every node inside ``bbox_wgs84``, every way touching it and every relation
    referencing those, plus all back-references so geometries stay complete."""
    west, south, east, north = bbox_wgs84
    nodes: set[int] = set()
    ways: set[int] = set()
    tmp = dst.with_name(dst.name + ".tmp.osm.pbf")
    tmp.unlink(missing_ok=True)

    def inside(loc: osmium.osm.Location) -> bool:
        return loc.valid() and west <= loc.lon <= east and south <= loc.lat <= north

    with osmium.BackReferenceWriter(str(tmp), ref_src=str(src), overwrite=True) as writer:
        for obj in osmium.FileProcessor(str(src)).with_locations():
            if obj.is_node():
                if inside(obj.location):
                    nodes.add(obj.id)
                    writer.add_node(obj)
            elif obj.is_way():
                if any(inside(n.location) for n in obj.nodes):
                    ways.add(obj.id)
                    writer.add_way(obj)
            elif obj.is_relation():
                if any((m.type == "w" and m.ref in ways) or (m.type == "n" and m.ref in nodes) for m in obj.members):
                    writer.add_relation(obj)
    tmp.replace(dst)
    log.info("OSM clip: %d nodes, %d ways in bbox -> %s", len(nodes), len(ways), dst)


def _to_rd(geom: BaseGeometry) -> BaseGeometry:
    def fn(coords: np.ndarray) -> np.ndarray:
        x, y = wgs84_to_rd(coords[:, 0], coords[:, 1])
        return np.column_stack([x, y])

    return shapely.transform(geom, fn)


def _tags(obj) -> dict[str, str]:
    return {t.k: t.v for t in obj.tags}


def load_osm(path: Path, bbox: RDBox) -> OsmData:
    """Parse a (clipped) OSM file into typed features in RD metres within ``bbox``."""
    data = OsmData()
    wkb = osmium.geom.WKBFactory()
    area = shp_box(*bbox.as_tuple())
    for obj in osmium.FileProcessor(str(path)).with_areas():
        if len(obj.tags) == 0:
            continue
        tags = _tags(obj)
        try:
            if obj.is_node():
                groups = classify_node(tags)
                if groups:
                    geom = shapely.from_wkb(wkb.create_point(obj))
                    _add(data, groups, f"node/{obj.id}", tags, geom, area)
            elif obj.is_way():
                groups = classify_way(tags)
                if groups:
                    geom = shapely.from_wkb(wkb.create_linestring(obj))
                    _add(data, groups, f"way/{obj.id}", tags, geom, area)
            elif obj.is_area():
                groups = classify_area(tags)
                if groups:
                    kind = "way" if obj.from_way() else "relation"
                    geom = shapely.from_wkb(wkb.create_multipolygon(obj))
                    _add(data, groups, f"{kind}/{obj.orig_id()}", tags, geom, area)
        except RuntimeError as exc:  # broken geometry in source data
            log.debug("skip %s: %s", obj, exc)
    return data


def _add(data: OsmData, groups: list[str], osm_id: str, tags: dict[str, str], geom: BaseGeometry, area) -> None:
    rd = _to_rd(geom)
    if rd.is_empty or not rd.intersects(area):
        return
    if rd.geom_type in ("Polygon", "MultiPolygon") and not rd.is_valid:
        rd = rd.buffer(0)
    for g in groups:
        getattr(data, g).append(OsmFeature(osm_id=osm_id, tags=tags, geom=rd))
