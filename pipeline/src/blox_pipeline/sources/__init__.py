"""External data sources: download (cached under ``data/raw``) and typed loaders."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ..geo import RDBox
from .ahn import fetch_ahn, load_ahn
from .bag3d import fetch_bag3d, load_buildings
from .ortho import fetch_ortho, load_ortho
from .osm import clip_path, fetch_osm, load_osm
from .model import Building, HeightGrid, OsmData, OsmFeature, RGBGrid, Surface

__all__ = [
    "Building", "HeightGrid", "OsmData", "OsmFeature", "RGBGrid", "Surface", "SourceData",
    "fetch_all", "load_all", "SOURCE_CREDITS",
]

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


ALL_SOURCES = ("ahn", "bag3d", "osm", "ortho")


def fetch_all(bbox: RDBox, only: tuple[str, ...] = ("ahn", "bag3d", "osm"), root: Path | None = None) -> None:
    if "ahn" in only:
        fetch_ahn("dtm", bbox, root)
        fetch_ahn("dsm", bbox, root)
    if "bag3d" in only:
        fetch_bag3d(bbox, root)
    if "osm" in only:
        fetch_osm(root)
    if "ortho" in only:
        fetch_ortho(bbox, root)


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
    return SourceData(
        dtm=dtm, dsm=dsm, buildings=load_buildings(bbox, root),
        osm=load_osm(osm_file, bbox), ortho=load_ortho(bbox, root),
    )
