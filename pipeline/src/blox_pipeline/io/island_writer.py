"""Write ``.bxi`` island files (CONTRACT 5.1).

Records come in as the pipeline's ``RECORD_DTYPE`` with ``I, J`` already local (0..255) and
``K`` global. The writer checks the island rules (inside 256 x 256, valid types, k range,
|yaw| <= 45) and sorts by ``(k, j, i)`` like a chunk.
"""

from __future__ import annotations

import hashlib
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from ..catalogue import Catalogue, load_catalogue
from ..layout.records import KNOWN_FLAGS, RECORD_DTYPE, Records, sort_records
from .format import FILE_RECORD_DTYPE, FLAG_DEFLATE
from .island_format import ISLAND_STUDS, IslandHeader, island_filename


@dataclass(frozen=True)
class IslandInfo:
    id: int
    cx: int
    cy: int
    file: str
    bricks: int
    sha1: str

    def manifest_entry(self) -> dict[str, Any]:
        return {"id": self.id, "file": self.file, "cx": self.cx, "cy": self.cy, "bricks": self.bricks,
                "sha1": self.sha1}


def _validate(rec: Records, yaw_deg: float, cat: Catalogue) -> None:
    if len(rec) == 0:
        raise ValueError("an island file needs at least one brick")
    if not -45.0 < yaw_deg <= 45.0:
        raise ValueError(f"island yaw {yaw_deg} outside (-45, 45]")
    ei, ej, eh = cat.extent_tables()
    t, rot = rec["type"].astype(np.int64), rec["rot"].astype(np.int64)
    if np.any(rot > 3) or np.any(ei[t, 0] == 0):
        raise ValueError("unknown brick type or rot > 3")
    i, j, k = (rec[n].astype(np.int64) for n in ("I", "J", "K"))
    if np.any(i < 0) or np.any(j < 0) or np.any(i + ei[t, rot] > ISLAND_STUDS) or np.any(j + ej[t, rot] > ISLAND_STUDS):
        raise ValueError("island brick outside the 256 x 256 local grid")
    if np.any(k < 0) or np.any(k + eh[t] > 0xFFFF):
        raise ValueError("brick k out of uint16 range")
    if np.any(rec["flags"] & ~np.uint8(KNOWN_FLAGS)):
        raise ValueError("unsupported flag bits")


def encode_island(rec: Records, island_id: int, cx: int, cy: int, origin: tuple[float, float], yaw_deg: float,
                  *, compress: bool = True, catalogue: Catalogue | None = None) -> bytes:
    cat = catalogue or load_catalogue()
    rec = np.asarray(rec, RECORD_DTYPE)
    _validate(rec, yaw_deg, cat)
    rec = sort_records(rec)
    body = np.zeros(len(rec), FILE_RECORD_DTYPE)
    body["i"], body["j"], body["k"] = rec["I"], rec["J"], rec["K"]
    body["typeId"], body["colorIdx"] = rec["type"], rec["color"]
    body["rotFlags"] = (rec["rot"] & 3) | rec["flags"]
    body["featureId"] = rec["featureId"]
    raw = body.tobytes()
    if compress:
        co = zlib.compressobj(level=9, method=zlib.DEFLATED, wbits=-15)
        raw = co.compress(raw) + co.flush()
    hdr = IslandHeader(island_id, cx, cy, float(origin[0]), float(origin[1]), float(yaw_deg), len(rec), len(raw),
                       FLAG_DEFLATE if compress else 0)
    return hdr.pack() + raw


def write_island(world_dir: Path | str, rec: Records, island_id: int, cx: int, cy: int,
                 origin: tuple[float, float], yaw_deg: float, *, compress: bool = True,
                 catalogue: Catalogue | None = None) -> IslandInfo:
    data = encode_island(rec, island_id, cx, cy, origin, yaw_deg, compress=compress, catalogue=catalogue)
    rel = f"islands/{island_filename(island_id)}"
    path = Path(world_dir) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return IslandInfo(island_id, cx, cy, rel, len(rec), hashlib.sha1(data).hexdigest())


__all__ = ["IslandInfo", "encode_island", "write_island"]
