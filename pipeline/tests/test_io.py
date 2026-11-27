import hashlib
import json
import struct
import zlib
from pathlib import Path

import numpy as np
import pytest

from blox_pipeline.catalogue import load_catalogue
from blox_pipeline.io import ChunkHeader, encode_chunk, read_chunk, read_manifest, read_world_records, write_world
from blox_pipeline.io.chunk_reader import decode_chunk
from blox_pipeline.io.make_golden import golden_records, make_golden
from blox_pipeline.layout import FLAG_NO_VARIATION, RECORD_DTYPE, sort_records

CAT = load_catalogue()
GOLDEN = Path(__file__).parent / "fixtures" / "golden"


def recs(rows):
    r = np.zeros(len(rows), RECORD_DTYPE)
    for n, row in enumerate(rows):
        r[n] = row
    return r


def sample(cx=3, cy=5):
    b = CAT.id("brick_2x4")
    return recs([
        (cx * 64 + 10, cy * 64 + 3, 400, b, 4, 1, 0, 12),
        (cx * 64 + 0, cy * 64 + 0, 90, CAT.id("plate_1x1"), 8, 0, FLAG_NO_VARIATION, 0),
        (cx * 64 + 62, cy * 64 + 60, 90, b, 1, 0, 0, 0xFFFFFFFF),
    ])


@pytest.mark.parametrize("compress", [True, False])
def test_chunk_round_trip(compress):
    data = encode_chunk(sample(), 3, 5, compress=compress)
    out = decode_chunk(data)
    assert out.header.compressed == compress
    assert np.array_equal(out.records, sort_records(sample()))
    assert out.header.brick_count == 3


def test_header_bytes_exact():
    data = encode_chunk(sample(), 3, 5, compress=False)
    assert len(data) == 32 + 3 * 12
    assert data[:4] == b"BXC1"
    magic, ver, flags, cx, cy, n, mink, maxk, body, res = struct.unpack_from("<4sHHiiIHHII", data)
    assert (ver, flags, cx, cy, n, mink, maxk, body, res) == (1, 0, 3, 5, 3, 90, 403, 36, 0)
    # first record in (k, j, i) order: plate at local (0, 0, 90)
    assert data[32:44] == bytes([0, 0, 90, 0, 12, 8, 0x04, 0, 0, 0, 0, 0])
    comp = encode_chunk(sample(), 3, 5, compress=True)
    assert struct.unpack_from("<H", comp, 6)[0] == 1
    assert zlib.decompress(comp[32:], wbits=-15) == data[32:]
    assert struct.unpack_from("<I", comp, 24)[0] == len(comp) - 32


def test_records_sorted_k_j_i_in_file():
    out = decode_chunk(encode_chunk(sample(), 3, 5))
    keys = list(zip(out.raw["k"], out.raw["j"], out.raw["i"]))
    assert keys == sorted(keys)


@pytest.mark.parametrize("bad", ["outside", "crossing", "k", "flags", "empty"])
def test_writer_rejects_invalid(bad):
    r = sample()
    if bad == "outside":
        r["I"][0] += 64
    elif bad == "crossing":
        r["I"][2] = 3 * 64 + 63  # 2x4 at i=63 spills into the next chunk
    elif bad == "k":
        r["K"][0] = 65534
    elif bad == "flags":
        r["flags"][0] = 0x10  # bit4+ reserved (bit3 = hide_studs is valid since v2)
    else:
        r = r[:0]
    with pytest.raises(ValueError):
        encode_chunk(r, 3, 5)


def test_reader_rejects_corruption():
    data = bytearray(encode_chunk(sample(), 3, 5))
    with pytest.raises(ValueError):
        decode_chunk(b"XXXX" + bytes(data[4:]))
    with pytest.raises(ValueError):
        decode_chunk(bytes(data[:-2]))
    hdr = ChunkHeader.unpack(bytes(data))
    assert hdr.pack() == bytes(data[:32])


def test_write_world(tmp_path):
    a, b = sample(3, 5), sample(4, 5)
    features = [{"id": 12, "kind": "building", "name": "Huis", "centroid": [0, 0], "bboxIJ": [0, 0, 1, 1]}]
    sources = [{"name": "3D BAG", "version": "v2024", "licence": "CC BY 4.0"}]
    (tmp_path / "chunks").mkdir()
    (tmp_path / "chunks" / "c_00_00.bxc").write_bytes(b"stale")
    mpath = write_world(tmp_path, [a, b[:1], b[1:]], features, sources, generated="2026-10-17T12:00:00Z")
    m = json.loads(mpath.read_text())
    assert m["contractVersion"] == 4 and m["islands"] == [] and m["originRD"] == [175700, 316500] and m["chunkStuds"] == 64
    assert m["generated"] == "2026-10-17T12:00:00Z" and m["sources"] == sources
    assert [(c["cx"], c["cy"], c["bricks"]) for c in m["chunks"]] == [(3, 5, 3), (4, 5, 3)]
    for c in m["chunks"]:
        data = (tmp_path / c["file"]).read_bytes()
        assert hashlib.sha1(data).hexdigest() == c["sha1"]
        assert c["file"] == f"chunks/c_{c['cx']:02d}_{c['cy']:02d}.bxc"
        assert (c["minK"], c["maxK"]) == (90, 403)
    assert not (tmp_path / "chunks" / "c_00_00.bxc").exists()
    assert json.loads((tmp_path / "features.json").read_text())["features"] == features
    for name in ("palette.json", "brick_catalogue.json"):
        assert (tmp_path / name).is_file()
    got = {(e["cx"], e["cy"]): d.records for e, d in read_world_records(tmp_path)}
    assert np.array_equal(got[(4, 5)], sort_records(b))  # parts of one chunk were merged
    assert read_manifest(tmp_path)["chunks"][0]["cx"] == 3


def test_write_world_validates_features(tmp_path):
    with pytest.raises(ValueError):
        write_world(tmp_path, sample(), [{"id": 0, "kind": "building"}])
    with pytest.raises(ValueError):
        write_world(tmp_path, sample(), [{"id": 1, "kind": "castle"}])
    with pytest.raises(ValueError):
        write_world(tmp_path, sample(), [], [{"name": "x"}])


def test_golden_fixture_is_current(tmp_path):
    """The committed golden files equal a fresh regeneration (reproducible bytes)."""
    doc = make_golden(tmp_path)
    for name in ("c_01_02.bxc", "c_01_02_uncompressed.bxc", "golden.json"):
        assert (tmp_path / name).read_bytes() == (GOLDEN / name).read_bytes(), name
    assert len(doc["records"]) == len(golden_records())


def test_golden_json_matches_files():
    doc = json.loads((GOLDEN / "golden.json").read_text())
    for name, meta in doc["files"].items():
        data = (GOLDEN / name).read_bytes()
        assert hashlib.sha1(data).hexdigest() == meta["sha1"]
        assert data[:32].hex() == meta["headerHex"]
        chunk = read_chunk(GOLDEN / name)
        assert chunk.raw.tobytes().hex() == doc["bodyHex"]
        for r, j in zip(chunk.raw, doc["records"]):
            assert (int(r["i"]), int(r["j"]), int(r["k"]), int(r["typeId"]), int(r["colorIdx"]),
                    int(r["rotFlags"]), int(r["featureId"])) == (
                j["i"], j["j"], j["k"], j["typeId"], j["colorIdx"], j["rotFlags"], j["featureId"])
    assert doc["files"]["c_01_02.bxc"]["header"]["maxK"] == 65535
