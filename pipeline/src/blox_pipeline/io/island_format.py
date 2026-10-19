"""Binary layout of ``islands/i_{id:06d}.bxi`` (CONTRACT section 5.1). Little-endian.

Same 12-byte BrickRecord body as a chunk (section 4), but ``i, j`` are *local* island cells
(0..255) and the 40-byte header carries the island pose instead of chunk bounds::

    char[4] magic "BXI1" | uint16 version 1 | uint16 flags (bit0 deflate) | uint32 islandId
    int32 cx | int32 cy | float32 originX | float32 originZ | float32 yawDeg
    uint32 brickCount | uint32 bodyBytes
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

from .format import FLAG_DEFLATE

MAGIC = b"BXI1"
VERSION = 1
HEADER = struct.Struct("<4sHHIiifffII")
HEADER_SIZE = 40
assert HEADER.size == HEADER_SIZE
ISLAND_STUDS = 256


def island_filename(island_id: int) -> str:
    return f"i_{island_id:06d}.bxi"


@dataclass(frozen=True)
class IslandHeader:
    island_id: int
    cx: int
    cy: int
    origin_x: float
    origin_z: float
    yaw_deg: float
    brick_count: int
    body_bytes: int
    flags: int = FLAG_DEFLATE
    version: int = VERSION
    magic: bytes = MAGIC

    @property
    def compressed(self) -> bool:
        return bool(self.flags & FLAG_DEFLATE)

    def pack(self) -> bytes:
        return HEADER.pack(self.magic, self.version, self.flags, self.island_id, self.cx, self.cy,
                           self.origin_x, self.origin_z, self.yaw_deg, self.brick_count, self.body_bytes)

    @classmethod
    def unpack(cls, data: bytes) -> "IslandHeader":
        if len(data) < HEADER_SIZE:
            raise ValueError(f"island header needs {HEADER_SIZE} bytes, got {len(data)}")
        magic, ver, flags, iid, cx, cy, ox, oz, yaw, n, body = HEADER.unpack_from(data, 0)
        if magic != MAGIC:
            raise ValueError(f"bad island magic {magic!r}")
        if ver != VERSION:
            raise ValueError(f"unsupported island version {ver}")
        return cls(iid, cx, cy, ox, oz, yaw, n, body, flags, ver, magic)
