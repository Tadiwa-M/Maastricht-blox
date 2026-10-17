"""Endpoints and cache locations for every external data source.

All URLs live here so they are easy to fix when a provider moves things. Values
were the best-known public endpoints at the time of writing (2026); none of them
could be reached from the build container, so verify with ``blox fetch`` on a
normal internet connection.
"""

from __future__ import annotations

import os
from pathlib import Path

# ---------------------------------------------------------------- AHN (PDOK WCS)
# AHN 0.5 m rasters as OGC WCS 2.0.1. Coverage ids: dtm_05m (bare earth, no data under
# buildings/water) and dsm_05m (surface incl. buildings/trees).
AHN_WCS_URL = "https://service.pdok.nl/rws/ahn/wcs/v1_0"
AHN_COVERAGE = {"dtm": "dtm_05m", "dsm": "dsm_05m"}
AHN_SUBSET_AXES = ("x", "y")  # WCS subset axis labels of the RD coverage
AHN_BLOCK_M = 512.0  # 1024 x 1024 px per request

# ---------------------------------------------------------------- 3D BAG (OGC API Features)
# Returns CityJSONFeature pages; follow links[rel=next]. Each page carries metadata.transform.
BAG3D_API_URL = "https://api.3dbag.nl/collections/pand/items"
BAG3D_BLOCK_M = 256.0
BAG3D_PAGE_LIMIT = 100
BAG3D_LICENCE = "CC BY 4.0"

# ---------------------------------------------------------------- OSM (Geofabrik)
OSM_PBF_URL = "https://download.geofabrik.de/europe/netherlands/limburg-latest.osm.pbf"
OSM_CLIP_MARGIN_M = 300.0  # keep a bit around the slice so ways at the edge are whole

# ---------------------------------------------------------------- PDOK aerial (WMS)
ORTHO_WMS_URL = "https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0"
ORTHO_LAYER = "Actueel_orthoHR"
ORTHO_BLOCK_M = 256.0
ORTHO_PX_PER_M = 2  # sample at stud resolution (0.5 m)

USER_AGENT = "maastricht-blox-pipeline/0.1 (+https://github.com/Tadiwa-M/Maastricht-blox)"
HTTP_TIMEOUT_S = 120


def repo_root() -> Path:
    # .../pipeline/src/blox_pipeline/sources/config.py -> repo root is parents[4]
    return Path(__file__).resolve().parents[4]


def data_dir() -> Path:
    """Raw download cache. Override with ``BLOX_DATA_DIR``."""
    env = os.environ.get("BLOX_DATA_DIR")
    return Path(env) if env else repo_root() / "data" / "raw"


def contract_dir() -> Path:
    return repo_root() / "contract"
