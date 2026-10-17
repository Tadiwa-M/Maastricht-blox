from __future__ import annotations

from pathlib import Path

import pytest

from blox_proxy.config import SLICE_BBOX_RD
from blox_proxy.gtfs.model import GtfsIndex
from blox_proxy.gtfs.preprocess import build_index

from builders import build_gtfs_zip


@pytest.fixture(scope="session")
def gtfs_zip(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return build_gtfs_zip(tmp_path_factory.mktemp("gtfs") / "gtfs-nl.zip")


@pytest.fixture(scope="session")
def gtfs_index(gtfs_zip: Path) -> GtfsIndex:
    return build_index(gtfs_zip, SLICE_BBOX_RD.expanded(500.0), 10.0)
