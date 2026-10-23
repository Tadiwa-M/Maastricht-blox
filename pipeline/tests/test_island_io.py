"""``.bxi`` island files (CONTRACT 5.1): writer/reader round trip, exact header bytes,
validation, manifest "islands", and the golden fixture shared with the C# reader."""

from __future__ import annotations

import hashlib
import json
import struct
import zlib
from pathlib import Path

import numpy as np
import pytest

from blox_pipeline.catalogue import load_catalogue
from blox_pipeline.io import decode_island, encode_island, read_island, read_manifest, read_world_islands, write_world
from blox_pipeline.io.make_golden import ISLAND_ORIGIN, ISLAND_YAW, golden_island_records, make_golden_island
from blox_pipeline.islands import Island, IslandPose, island_local_to_world
from blox_pipeline.layout import FLAG_NO_VARIATION, RECORD_DTYPE, sort_records
from blox_pipeline.layout.records import FLAG_HIDE_STUDS

CAT = load_catalogue()
GOLDEN = Path(__file__).parent / "fixtures" / "golden"


def recs(rows):
    r = np.zeros(len(rows), RECORD_DTYPE)
    for n, row in enumerate(rows):
        r[n] = row
    return r


def sample():
    b = CAT.id("brick_2x4")
    return recs([
        (200, 3, 400, b, 4, 1, 0, 12),
        (0, 0, 90, CAT.id("plate_1x1"), 8, 0, FLAG_NO_VARIATION, 0),
        (254, 252, 90, b, 1, 0, FLAG_HIDE_STUDS, 0xFFFFFFFF),  # 2 x 4: ends exactly on both 256 edges
    ])


@pytest.mark.parametrize("compress", [True, False])
def test_island_round_trip(compress):
    data = encode_island(sample(), 7, 12, 40, (485.0, 1217.0), 20.0, compress=compress)
    out = decode_island(data)
    assert out.header.compressed == compress
    assert (out.header.island_id, out.header.cx, out.header.cy) == (7, 12, 40)
    assert out.origin == (485.0, 1217.0) and out.yaw_deg == 20.0
    assert np.array_equal(out.records, sort_records(sample()))


def test_island_header_bytes_exact():
    data = encode_island(sample(), 7, 12, 40, (485.0, 1217.0), -33.5, compress=False)
    assert len(data) == 40 + 3 * 12 and data[:4] == b"BXI1"
    magic, ver, flags, iid, cx, cy, ox, oz, yaw, n, body = struct.unpack_from("<4sHHIiifffII", data)
    assert (ver, flags, iid, cx, cy, ox, oz, yaw, n, body) == (1, 0, 7, 12, 40, 485.0, 1217.0, -33.5, 3, 36)
    assert data[40:52] == bytes([0, 0, 90, 0, 12, 8, 0x04, 0, 0, 0, 0, 0])  # (k, j, i) order, local i/j
    comp = encode_island(sample(), 7, 12, 40, (485.0, 1217.0), -33.5)
    assert struct.unpack_from("<H", comp, 6)[0] == 1
    assert zlib.decompress(comp[40:], wbits=-15) == data[40:]
    assert struct.unpack_from("<I", comp, 36)[0] == len(comp) - 40


@pytest.mark.parametrize("row", [
    (255, 0, 90, "brick_2x4", 0),     # i + 2 > 256
    (0, 253, 90, "brick_2x4", 0),     # j + 4 > 256
    (253, 0, 90, "brick_2x4", 1),     # turned: i + 4 > 256
    (-1, 0, 90, "plate_1x1", 0),
    (0, 0, 65534, "brick_2x4", 0),    # k + h > 65535
])
def test_island_writer_rejects_bad_records(row):
    i, j, k, name, rot = row
    with pytest.raises(ValueError):
        encode_island(recs([(i, j, k, CAT.id(name), 1, rot, 0, 0)]), 1, 0, 0, (0.0, 0.0), 10.0)


@pytest.mark.parametrize("yaw", [-45.0, 45.5, 90.0])
def test_island_writer_rejects_yaw_outside_range(yaw):
    with pytest.raises(ValueError):
        encode_island(sample(), 1, 0, 0, (0.0, 0.0), yaw)
    encode_island(sample(), 1, 0, 0, (0.0, 0.0), 45.0)  # the closed end is fine


def test_island_reader_rejects_corruption():
    data = bytearray(encode_island(sample(), 1, 0, 0, (0.0, 0.0), 10.0, compress=False))
    with pytest.raises(ValueError):
        decode_island(b"BXC1" + bytes(data[4:]))
    with pytest.raises(ValueError):
        decode_island(bytes(data[:-1]))
    data[40 + 7] = 1  # reserved byte of the first record
    with pytest.raises(ValueError):
        decode_island(bytes(data))


def test_write_world_lists_islands(tmp_path):
    a = Island(3, IslandPose((485.0, 1217.0), 20.0), 15, 38, sample())
    b = Island(1, IslandPose((600.0, 1000.0), -12.0), 18, 31, sample()[:1])
    (tmp_path / "islands").mkdir()
    (tmp_path / "islands" / "i_000099.bxi").write_bytes(b"stale")
    write_world(tmp_path, [], [], [], islands=[a, b], generated="2026-10-19T12:00:00Z")
    m = read_manifest(tmp_path)
    assert m["contractVersion"] == 3
    assert [(e["id"], e["file"], e["cx"], e["cy"], e["bricks"]) for e in m["islands"]] == [
        (1, "islands/i_000001.bxi", 18, 31, 1), (3, "islands/i_000003.bxi", 15, 38, 3)]
    for e in m["islands"]:
        assert hashlib.sha1((tmp_path / e["file"]).read_bytes()).hexdigest() == e["sha1"]
    assert not (tmp_path / "islands" / "i_000099.bxi").exists()
    got = {e["id"]: d for e, d in read_world_islands(tmp_path)}
    assert got[3].yaw_deg == 20.0 and np.array_equal(got[3].records, sort_records(sample()))


def test_read_world_islands_checks_sha1(tmp_path):
    write_world(tmp_path, [], [], [], islands=[Island(1, IslandPose((0.0, 0.0), 10.0), 0, 0, sample())])
    path = tmp_path / "islands" / "i_000001.bxi"
    data = bytearray(path.read_bytes())
    data[-1] ^= 0xFF
    path.write_bytes(bytes(data))
    with pytest.raises(ValueError):
        list(read_world_islands(tmp_path))


def test_golden_island_is_current(tmp_path):
    doc = make_golden_island(tmp_path)
    for name in ("i_000001.bxi", "i_000001_uncompressed.bxi", "golden_island.json"):
        assert (tmp_path / name).read_bytes() == (GOLDEN / name).read_bytes(), name
    assert len(doc["records"]) == len(golden_island_records())


def test_golden_island_json_matches_files():
    doc = json.loads((GOLDEN / "golden_island.json").read_text())
    for name, meta in doc["files"].items():
        data = (GOLDEN / name).read_bytes()
        assert hashlib.sha1(data).hexdigest() == meta["sha1"] and len(data) == meta["size"]
        assert data[:40].hex() == meta["headerHex"]
        isl = read_island(GOLDEN / name)
        h = meta["header"]
        assert (isl.header.island_id, isl.header.cx, isl.header.cy, isl.header.brick_count) == (
            h["islandId"], h["cx"], h["cy"], h["brickCount"])
        assert (isl.header.origin_x, isl.header.origin_z, isl.header.yaw_deg) == (h["originX"], h["originZ"], h["yawDeg"])
        assert isl.raw.tobytes().hex() == doc["bodyHex"]
        for r, j in zip(isl.raw, doc["records"]):
            assert (int(r["i"]), int(r["j"]), int(r["k"]), int(r["typeId"]), int(r["colorIdx"]),
                    int(r["rotFlags"]), int(r["featureId"])) == (
                j["i"], j["j"], j["k"], j["typeId"], j["colorIdx"], j["rotFlags"], j["featureId"])
            x, z = island_local_to_world(ISLAND_ORIGIN, ISLAND_YAW, j["i"] * 0.5, j["j"] * 0.5)
            assert j["world"] == pytest.approx([x, j["k"] * 0.2, z], abs=1e-5)
    recs_ = doc["records"]
    assert max(r["i"] for r in recs_) == 255 and max(r["k"] for r in recs_) > 255
    assert {r["rot"] for r in recs_} == {0, 1, 2, 3} and any(r["hideStuds"] and r["noVariation"] for r in recs_)
