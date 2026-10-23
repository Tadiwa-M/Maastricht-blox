"""Reproducible golden chunk fixture for cross-language (C#) byte-compatibility tests.

Run: ``uv run python -m blox_pipeline.io.make_golden [--out DIR]``
(default ``pipeline/tests/fixtures/golden``). Writes ``c_01_02.bxc`` (DEFLATE),
``c_01_02_uncompressed.bxc`` and ``golden.json`` listing every header and record field, and
the island equivalent (CONTRACT 5.1): ``i_000001.bxi`` (DEFLATE),
``i_000001_uncompressed.bxi`` and ``golden_island.json``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from ..catalogue import load_catalogue, repo_root
from ..layout.records import CHUNK, FLAG_HIDE_STUDS, FLAG_NO_VARIATION, RECORD_DTYPE, Records
from .chunk_reader import decode_chunk
from .chunk_writer import encode_chunk
from .format import ChunkHeader
from .island_format import IslandHeader
from .island_reader import decode_island
from .island_writer import encode_island

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


# Island golden: local cells up to 255 (bricks ending exactly on the 256 edge), every rot,
# k > 255, both flag bits, a negative yaw and float32-exact pose values.
ISLAND_ID = 1
ISLAND_ORIGIN = (612.25, 1344.75)
ISLAND_YAW = -33.5
ISLAND_CX, ISLAND_CY = 19, 44  # chunk of the island centre (owning chunk, see islands.build.owning_chunk)
GOLDEN_ISLAND_BRICKS = [
    (0, 0, 120, "brick_2x4", 1, 0, 0, 7),
    (252, 0, 120, "brick_2x4", 4, 1, 0, 7),
    (255, 255, 121, "plate_1x1", 8, 0, NV, 0xFFFFFFFF),
    (100, 200, 300, "slope45_2x2", 13, 2, 0, 70000),
    (128, 128, 125, "window_1x2x3", 41, 3, 0, 0x01020304),
    (40, 252, 130, "tile_2x4", 23, 2, FLAG_HIDE_STUDS, 3),
    (10, 20, 65532, "plate_1x2", 26, 1, NV | FLAG_HIDE_STUDS, 0x80000000),
]


def golden_island_records() -> Records:
    cat = load_catalogue()
    rec = np.zeros(len(GOLDEN_ISLAND_BRICKS), RECORD_DTYPE)
    for n, (i, j, k, name, c, rot, flags, fid) in enumerate(GOLDEN_ISLAND_BRICKS):
        rec[n] = (i, j, k, cat.id(name), c, rot, flags, fid)
    return rec


def _island_header_json(h: IslandHeader) -> dict:
    return {"magic": h.magic.decode("ascii"), "version": h.version, "flags": h.flags, "islandId": h.island_id,
            "cx": h.cx, "cy": h.cy, "originX": h.origin_x, "originZ": h.origin_z, "yawDeg": h.yaw_deg,
            "brickCount": h.brick_count, "bodyBytes": h.body_bytes}


def make_golden_island(out: Path) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    cat = load_catalogue()
    rec = golden_island_records()
    stem = f"i_{ISLAND_ID:06d}"
    files = {f"{stem}.bxi": True, f"{stem}_uncompressed.bxi": False}
    doc: dict = {
        "description": "Golden BXI1 island (CONTRACT section 5.1). Records in file order (k, j, i); "
                       "i, j are local island cells. 'world' is the local min corner of each record "
                       "turned into Unity metres by the island pose.",
        "generator": "uv run python -m blox_pipeline.io.make_golden",
        "files": {},
    }
    for name, compress in files.items():
        data = encode_island(rec, ISLAND_ID, ISLAND_CX, ISLAND_CY, ISLAND_ORIGIN, ISLAND_YAW,
                             compress=compress, catalogue=cat)
        (out / name).write_bytes(data)
        hdr = IslandHeader.unpack(data)
        doc["files"][name] = {"size": len(data), "sha1": hashlib.sha1(data).hexdigest(),
                              "header": _island_header_json(hdr), "headerHex": data[:40].hex()}
    isl = decode_island((out / f"{stem}_uncompressed.bxi").read_bytes())
    from ..islands.pose import island_local_to_world

    doc["bodyHex"] = isl.raw.tobytes().hex()
    doc["records"] = []
    for r in isl.raw:
        x, z = island_local_to_world(isl.origin, isl.yaw_deg, int(r["i"]) * 0.5, int(r["j"]) * 0.5)
        doc["records"].append(
            {"i": int(r["i"]), "j": int(r["j"]), "k": int(r["k"]), "typeId": int(r["typeId"]),
             "typeName": cat[int(r["typeId"])].name, "colorIdx": int(r["colorIdx"]),
             "rot": int(r["rotFlags"]) & 3, "noVariation": bool(r["rotFlags"] & NV),
             "hideStuds": bool(r["rotFlags"] & FLAG_HIDE_STUDS), "rotFlags": int(r["rotFlags"]),
             "reserved": int(r["reserved"]), "featureId": int(r["featureId"]),
             "world": [round(x, 6), round(r["k"] * 0.2, 6), round(z, 6)]})
    (out / "golden_island.json").write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    return doc


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
    isl = make_golden_island(args.out)
    print(f"wrote {len(doc['records'])} golden chunk records and {len(isl['records'])} island records to {args.out}")


if __name__ == "__main__":
    main()
