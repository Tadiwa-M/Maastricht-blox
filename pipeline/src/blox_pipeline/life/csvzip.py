"""Stream CSV rows out of a GTFS zip without extracting it (gtfs-nl is ~1.5 GB unzipped).

Ported from ``proxy/src/blox_proxy/gtfs/csvzip.py`` (the pipeline and proxy are separate
packages and share no code).
"""

from __future__ import annotations

import csv
import io
import zipfile
from collections.abc import Iterator


def has_file(zf: zipfile.ZipFile, name: str) -> bool:
    return name in zf.namelist()


def iter_rows(zf: zipfile.ZipFile, name: str, columns: list[str], optional: frozenset[str] = frozenset()) -> Iterator[list[str]]:
    """Yield rows as lists ordered like ``columns``. Missing optional columns yield ""."""
    if not has_file(zf, name):
        raise FileNotFoundError(f"{name} not in GTFS zip")
    with zf.open(name) as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
        reader = csv.reader(text)
        header = [h.strip() for h in next(reader)]
        idx: list[int] = []
        for c in columns:
            if c in header:
                idx.append(header.index(c))
            elif c in optional:
                idx.append(-1)
            else:
                raise KeyError(f"{name}: missing column {c!r}")
        for row in reader:
            if not row:
                continue
            yield [row[i].strip() if 0 <= i < len(row) else "" for i in idx]


def gtfs_seconds(text: str) -> int:
    """``HH:MM:SS`` (hours may exceed 23 for trips past midnight) -> seconds since midnight."""
    h, m, s = text.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)
