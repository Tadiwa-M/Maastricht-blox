"""Read ``.bxi`` island files (CONTRACT 5.1): header (pose) + records in local ``I, J``."""

from __future__ import annotations

import hashlib
import zlib
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..layout.records import KNOWN_FLAGS, RECORD_DTYPE, Records
from .format import FILE_RECORD_DTYPE, RECORD_SIZE
from .island_format import HEADER_SIZE, IslandHeader


@dataclass
class IslandData:
    header: IslandHeader
    records: Records  # local I, J (0..255), global K
    raw: np.ndarray   # file records, as stored

    @property
    def origin(self) -> tuple[float, float]:
        return self.header.origin_x, self.header.origin_z

    @property
    def yaw_deg(self) -> float:
        return self.header.yaw_deg


def decode_island(data: bytes) -> IslandData:
    hdr = IslandHeader.unpack(data)
    body = data[HEADER_SIZE:]
    if len(body) != hdr.body_bytes:
        raise ValueError(f"body is {len(body)} bytes, header says {hdr.body_bytes}")
    if hdr.compressed:
        d = zlib.decompressobj(wbits=-15)
        body = d.decompress(body) + d.flush()
        if not d.eof:
            raise ValueError("truncated DEFLATE body")
    if len(body) != hdr.brick_count * RECORD_SIZE:
        raise ValueError(f"body holds {len(body)} bytes for {hdr.brick_count} records")
    raw = np.frombuffer(body, FILE_RECORD_DTYPE).copy()
    rec = np.zeros(len(raw), RECORD_DTYPE)
    rec["I"], rec["J"], rec["K"] = raw["i"], raw["j"], raw["k"]
    rec["type"], rec["color"] = raw["typeId"], raw["colorIdx"]
    rec["rot"] = raw["rotFlags"] & 3
    rec["flags"] = raw["rotFlags"] & ~np.uint8(3)
    rec["featureId"] = raw["featureId"]
    if np.any(rec["flags"] & ~np.uint8(KNOWN_FLAGS)) or np.any(raw["reserved"]):
        raise ValueError("reserved bits set in island records")
    return IslandData(hdr, rec, raw)


def read_island(path: Path | str) -> IslandData:
    return decode_island(Path(path).read_bytes())


def read_world_islands(world_dir: Path | str, *, check_sha1: bool = True) -> Iterator[tuple[dict, IslandData]]:
    """Yield ``(manifest island entry, island data)`` for every island in the manifest."""
    from .chunk_reader import read_manifest

    world = Path(world_dir)
    for entry in read_manifest(world).get("islands", []):
        data = (world / entry["file"]).read_bytes()
        if check_sha1 and hashlib.sha1(data).hexdigest() != entry["sha1"]:
            raise ValueError(f"sha1 mismatch for {entry['file']}")
        isl = decode_island(data)
        if isl.header.island_id != entry["id"]:
            raise ValueError(f"{entry['file']}: header id {isl.header.island_id} != manifest id {entry['id']}")
        yield entry, isl


__all__ = ["IslandData", "decode_island", "read_island", "read_world_islands"]
