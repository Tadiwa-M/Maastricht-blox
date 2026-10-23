"""Binary layout of ``chunks/c_XX_YY.bxc`` (CONTRACT section 4). Little-endian."""

from __future__ import annotations

import struct
from dataclasses import dataclass

import numpy as np

MAGIC = b"BXC1"
VERSION = 1
FLAG_DEFLATE = 0x0001
HEADER = struct.Struct("<4sHHiiIHHII")
HEADER_SIZE = 32
assert HEADER.size == HEADER_SIZE

FILE_RECORD_DTYPE = np.dtype(
    [
        ("i", "u1"), ("j", "u1"), ("k", "<u2"), ("typeId", "u1"), ("colorIdx", "u1"),
        ("rotFlags", "u1"), ("reserved", "u1"), ("featureId", "<u4"),
    ]
)
RECORD_SIZE = 12
assert FILE_RECORD_DTYPE.itemsize == RECORD_SIZE


def chunk_filename(cx: int, cy: int) -> str:
    return f"c_{cx:02d}_{cy:02d}.bxc"


@dataclass(frozen=True)
class ChunkHeader:
    cx: int
    cy: int
    brick_count: int
    min_k: int
    max_k: int
    body_bytes: int
    flags: int = FLAG_DEFLATE
    version: int = VERSION
    magic: bytes = MAGIC
    reserved: int = 0

    @property
    def compressed(self) -> bool:
        return bool(self.flags & FLAG_DEFLATE)

    def pack(self) -> bytes:
        return HEADER.pack(
            self.magic, self.version, self.flags, self.cx, self.cy, self.brick_count,
            self.min_k, self.max_k, self.body_bytes, self.reserved,
        )

    @classmethod
    def unpack(cls, data: bytes) -> "ChunkHeader":
        if len(data) < HEADER_SIZE:
            raise ValueError(f"chunk header needs {HEADER_SIZE} bytes, got {len(data)}")
        magic, ver, flags, cx, cy, n, mink, maxk, body, res = HEADER.unpack_from(data, 0)
        if magic != MAGIC:
            raise ValueError(f"bad chunk magic {magic!r}")
        if ver != VERSION:
            raise ValueError(f"unsupported chunk version {ver}")
        return cls(cx, cy, n, mink, maxk, body, flags, ver, magic, res)
