"""Reproducible golden chunk fixture for cross-language (C#) byte-compatibility tests.

Run: ``uv run python -m blox_pipeline.io.make_golden [--out DIR]``
(default ``pipeline/tests/fixtures/golden``). Writes ``c_01_02.bxc`` (DEFLATE),
``c_01_02_uncompressed.bxc`` and ``golden.json`` listing every header and record field.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from ..catalogue import load_catalogue, repo_root
from ..layout.records import CHUNK, FLAG_NO_VARIATION, RECORD_DTYPE, Records
from .chunk_reader import decode_chunk
from .chunk_writer import encode_chunk
from .format import ChunkHeader

CX, CY = 1, 2
NV = FLAG_NO_VARIATION

# (local i, local j, k, brick name, palette idx, rot, flags, featureId): every rotation,
# chunk-edge positions, k > 255, k + h == 65535, the no_variation bit and featureIds
# that exercise all four bytes.
GOLDEN_BRICKS = [
    (0, 0, 100, "brick_2x4", 1, 0, 0, 0),
    (10, 0, 100, "brick_2x4", 4, 1, 0, 1),
    (63, 63, 0, "plate_1x1", 8, 0, 0, 0xFFFFFFFF),
    (20, 20, 300, "slope45_2x2", 13, 2, 0, 70000),
    (30, 5, 65532, "slope33_2x3", 12, 3, 0, 2),
    (0, 60, 90, "tile_2x4", 23, 1, NV, 3),
    (5, 30, 101, "slope_double45_1x2", 14, 0, 0, 0x01020304),
    (62, 0, 50, "round_brick_1x1", 36, 3, NV, 0x80000000),
    (40, 40, 100, "plate_4x4", 26, 0, 0, 5),
]


def golden_records() -> Records:
    cat = load_catalogue()
    rec = np.zeros(len(GOLDEN_BRICKS), RECORD_DTYPE)
    for n, (i, j, k, name, c, rot, flags, fid) in enumerate(GOLDEN_BRICKS):
        rec[n] = (CX * CHUNK + i, CY * CHUNK + j, k, cat.id(name), c, rot, flags, fid)
    return rec


def _header_json(h: ChunkHeader) -> dict:
    return {"magic": h.magic.decode("ascii"), "version": h.version, "flags": h.flags, "cx": h.cx,
            "cy": h.cy, "brickCount": h.brick_count, "minK": h.min_k, "maxK": h.max_k,
            "bodyBytes": h.body_bytes, "reserved": h.reserved}


def make_golden(out: Path) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    cat = load_catalogue()
    rec = golden_records()
    files = {"c_01_02.bxc": True, "c_01_02_uncompressed.bxc": False}
    doc: dict = {
        "description": "Golden BXC1 chunk (CONTRACT section 4). Records in file order (k, j, i).",
        "generator": "uv run python -m blox_pipeline.io.make_golden",
        "files": {},
    }
    for name, compress in files.items():
        data = encode_chunk(rec, CX, CY, compress=compress, catalogue=cat)
        (out / name).write_bytes(data)
        hdr = ChunkHeader.unpack(data)
        doc["files"][name] = {"size": len(data), "sha1": hashlib.sha1(data).hexdigest(),
                              "header": _header_json(hdr), "headerHex": data[:32].hex()}
    chunk = decode_chunk((out / "c_01_02_uncompressed.bxc").read_bytes())
    doc["bodyHex"] = chunk.raw.tobytes().hex()
    doc["records"] = [
        {"i": int(r["i"]), "j": int(r["j"]), "k": int(r["k"]), "typeId": int(r["typeId"]),
         "typeName": cat[int(r["typeId"])].name, "colorIdx": int(r["colorIdx"]),
         "rot": int(r["rotFlags"]) & 3, "noVariation": bool(r["rotFlags"] & NV),
         "rotFlags": int(r["rotFlags"]), "reserved": int(r["reserved"]),
         "featureId": int(r["featureId"]), "I": int(g["I"]), "J": int(g["J"]), "K": int(g["K"])}
        for r, g in zip(chunk.raw, chunk.records)
    ]
    (out / "golden.json").write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    return doc


def default_out() -> Path:
    return repo_root() / "pipeline" / "tests" / "fixtures" / "golden"


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=default_out())
    args = ap.parse_args(argv)
    doc = make_golden(args.out)
    print(f"wrote {len(doc['records'])} golden records to {args.out}")


if __name__ == "__main__":
    main()
