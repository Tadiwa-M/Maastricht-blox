"""External data sources: download (cached under ``data/raw``) and typed loaders."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from ..geo import RDBox
from .ahn import fetch_ahn, load_ahn
from .bag3d import fetch_bag3d, load_buildings
from .ortho import fetch_ortho, load_ortho
from .osm import clip_path, fetch_osm, load_osm
from .http import DownloadError
from .model import Building, HeightGrid, OsmData, OsmFeature, RGBGrid, Surface
from .osm_buildings import fallback_buildings

__all__ = [
    "Building", "HeightGrid", "OsmData", "OsmFeature", "RGBGrid", "Surface", "SourceData",
    "fetch_all", "load_all", "SOURCE_CREDITS",
]

log = logging.getLogger(__name__)

SOURCE_CREDITS = [
    {"name": "AHN", "version": "AHN 0.5 m DTM/DSM", "licence": "CC0 (AHN4 via PDOK) / CC BY 4.0 (AHN5, AHN6)",
     "attribution": "AHN.nl"},
    {"name": "3D BAG", "version": "api.3dbag.nl", "licence": "CC BY 4.0",
     "attribution": "3D BAG by TU Delft 3D geoinformation"},
    {"name": "OpenStreetMap", "version": "Geofabrik limburg-latest", "licence": "ODbL",
     "attribution": "OpenStreetMap contributors"},
]
ORTHO_CREDIT = {"name": "PDOK Luchtfoto", "version": "Actueel_orthoHR", "licence": "CC BY 4.0",
                "attribution": "Beeldmateriaal Nederland"}


@dataclass
class SourceData:
    dtm: HeightGrid
    dsm: HeightGrid | None
    buildings: list[Building]
    osm: OsmData
    ortho: RGBGrid | None


ALL_SOURCES = ("ahn", "bag3d", "osm", "ortho", "gtfs")


def fetch_all(bbox: RDBox, only: tuple[str, ...] = ("ahn", "bag3d", "osm"), root: Path | None = None) -> None:
    """Fetch each requested source. A failing source does not stop the others; the
    failures are raised together at the end (3D BAG can be down while OSM is fine)."""
    steps: dict[str, Callable[[], object]] = {
        "ahn": lambda: (fetch_ahn("dtm", bbox, root), fetch_ahn("dsm", bbox, root)),
        "bag3d": lambda: fetch_bag3d(bbox, root),
        "osm": lambda: fetch_osm(root),
        "ortho": lambda: fetch_ortho(bbox, root),
        "gtfs": lambda: _fetch_gtfs(root),
    }
    failed: list[str] = []
    for name in ALL_SOURCES:
        if name not in only:
            continue
        try:
            steps[name]()
        except DownloadError as exc:
            log.error("fetch %s failed: %s", name, exc)
            failed.append(name)
    if failed:
        raise DownloadError(f"failed sources: {', '.join(failed)} (the others are cached; rerun to resume)")


def _fetch_gtfs(root: Path | None) -> None:
    from ..life.fetch import fetch_gtfs

    fetch_gtfs(root)


def load_all(bbox: RDBox, root: Path | None = None) -> SourceData:
    """Load everything cached for ``bbox`` (DSM and ortho are optional)."""
    dtm = load_ahn("dtm", bbox, root)
    try:
        dsm: HeightGrid | None = load_ahn("dsm", bbox, root, fill=False)
    except FileNotFoundError:
        dsm = None
    osm_file = clip_path(root)
    if not osm_file.exists():
        raise FileNotFoundError(f"OSM clip {osm_file} missing, run 'blox fetch'")
    osm = load_osm(osm_file, bbox)
    try:
        buildings = load_buildings(bbox, root)
    except FileNotFoundError:
        log.warning("no 3D BAG data cached: all buildings come from OSM footprints + AHN heights")
        buildings = []
    buildings += fallback_buildings(osm, buildings, dtm, dsm)
    return SourceData(
        dtm=dtm, dsm=dsm, buildings=buildings,
        osm=osm, ortho=load_ortho(bbox, root),
    )
