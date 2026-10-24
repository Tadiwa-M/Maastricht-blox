"""Read ``.bxc`` chunk files and world manifests (tests and tooling)."""

from __future__ import annotations

import hashlib
import json
import zlib
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from ..layout.records import CHUNK, KNOWN_FLAGS, RECORD_DTYPE, Records
from .format import FILE_RECORD_DTYPE, HEADER_SIZE, RECORD_SIZE, ChunkHeader


@dataclass
class ChunkData:
    header: ChunkHeader
    records: Records  # global I, J, K
    raw: np.ndarray  # file records (local i, j), as stored


def decode_chunk(data: bytes) -> ChunkData:
    hdr = ChunkHeader.unpack(data)
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
    rec["I"] = raw["i"].astype(np.int32) + hdr.cx * CHUNK
    rec["J"] = raw["j"].astype(np.int32) + hdr.cy * CHUNK
    rec["K"] = raw["k"]
    rec["type"] = raw["typeId"]
    rec["color"] = raw["colorIdx"]
    rec["rot"] = raw["rotFlags"] & 3
    rec["flags"] = raw["rotFlags"] & ~np.uint8(3)
    rec["featureId"] = raw["featureId"]
    if np.any(rec["flags"] & ~np.uint8(KNOWN_FLAGS)) or np.any(raw["reserved"]):
        raise ValueError("reserved bits set in chunk records")
    return ChunkData(hdr, rec, raw)


def read_chunk(path: Path | str) -> ChunkData:
    return decode_chunk(Path(path).read_bytes())


# Older worlds read unchanged: v2 only added rotFlags bit3, v3 only added "islands"
# (absent = none; read them with island_reader.read_world_islands).
SUPPORTED_CONTRACT_VERSIONS = (1, 2, 3, 4)


def read_manifest(world_dir: Path | str) -> dict[str, Any]:
    doc = json.loads((Path(world_dir) / "manifest.json").read_text(encoding="utf-8"))
    if doc.get("contractVersion") not in SUPPORTED_CONTRACT_VERSIONS:
        raise ValueError(f"unsupported contractVersion {doc.get('contractVersion')!r}")
    return doc


def read_world_records(world_dir: Path | str, *, check_sha1: bool = True) -> Iterator[tuple[dict, ChunkData]]:
    """Yield ``(manifest chunk entry, chunk data)`` for every chunk in the manifest."""
    world = Path(world_dir)
    for entry in read_manifest(world)["chunks"]:
        data = (world / entry["file"]).read_bytes()
        if check_sha1 and hashlib.sha1(data).hexdigest() != entry["sha1"]:
            raise ValueError(f"sha1 mismatch for {entry['file']}")
        yield entry, decode_chunk(data)
