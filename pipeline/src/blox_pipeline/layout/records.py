"""In-memory brick records: global coordinates, one row per brick."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

CHUNK = 64  # studs per chunk side (CONTRACT section 1)
WORLD_STUDS = 4096  # slice size in studs
FLAG_NO_VARIATION = 0x04  # rotFlags bit2 (CONTRACT section 4); stored at the same bit here

RECORD_DTYPE = np.dtype(
    [
        ("I", "<i4"),  # global min corner of the rotated bounding box
        ("J", "<i4"),
        ("K", "<i4"),
        ("type", "u1"),  # brick_catalogue id
        ("color", "u1"),  # palette idx
        ("rot", "u1"),  # 0..3
        ("flags", "u1"),  # contract rotFlags bits 2..7 (rot bits always 0 here)
        ("featureId", "<u4"),
    ]
)

Records = NDArray[np.void]


def empty_records(n: int = 0) -> Records:
    return np.zeros(n, RECORD_DTYPE)


def concat_records(parts: list[Records]) -> Records:
    parts = [p for p in parts if len(p)]
    return np.concatenate(parts).astype(RECORD_DTYPE) if parts else empty_records()


def sort_records(rec: Records) -> Records:
    """Sort by ``(K, J, I)`` (the chunk file order, CONTRACT section 4)."""
    return rec[np.lexsort((rec["I"], rec["J"], rec["K"]))]


def chunk_keys(rec: Records) -> tuple[NDArray[np.int64], NDArray[np.int64]]:
    """``(cx, cy)`` of the chunk owning each record (by record position)."""
    return rec["I"].astype(np.int64) // CHUNK, rec["J"].astype(np.int64) // CHUNK
