import numpy as np
from PIL import Image

from blox_pipeline.catalogue import load_catalogue
from blox_pipeline.io import write_world
from blox_pipeline.layout import RECORD_DTYPE
from blox_pipeline.palette import load_palette
from blox_pipeline.preview import column_tops, render_chunk_iso, render_preview

CAT, PAL = load_catalogue(), load_palette()


def world(tmp_path):
    r = np.zeros(3, RECORD_DTYPE)
    r[0] = (64 * 2, 64 * 3, 100, CAT.id("plate_4x4"), PAL.idx("grass"), 0, 0, 0)
    r[1] = (64 * 2, 64 * 3, 101, CAT.id("brick_1x1"), PAL.idx("brick_red"), 0, 0, 0)
    r[2] = (64 * 3 + 5, 64 * 3, 50, CAT.id("tile_1x2"), PAL.idx("water"), 1, 0, 0)
    write_world(tmp_path, r, [], [])
    return r


def test_column_tops_picks_highest():
    r = np.zeros(2, RECORD_DTYPE)
    r[0] = (0, 0, 10, CAT.id("plate_2x2"), 8, 0, 0, 0)
    r[1] = (1, 1, 11, CAT.id("slope45_2x2"), 13, 0, 0, 0)
    t = column_tops(r, 0, 0, 3, 3)
    assert t.top[0, 0] == 11 and t.color[0, 0] == 8
    assert t.top[1, 1] == 14 and t.color[1, 1] == 13
    # rot 0 slope: the back (studded) row is at -j, the low edge row at +j has no stud
    assert t.stud[1, 1] and not t.stud[2, 1]
    assert t.top[2, 2] == 14 and t.top[0, 2] == -1


def test_render_preview(tmp_path):
    world(tmp_path)
    path = render_preview(tmp_path)
    img = np.asarray(Image.open(path))
    assert img.shape == (64 * 4, 128 * 4, 3)  # chunks (2,3) and (3,3) at 4 px per stud
    # brick at the SW corner of chunk (2,3): north-up image -> bottom-left; red dominates
    px = img[-3, 1].astype(int)
    assert px[0] > px[1] and px[0] > px[2]
    small = np.asarray(Image.open(render_preview(tmp_path, out_name="p1.png", px_per_stud=1)))
    assert small.shape == (64, 128, 3)
    tiny = Image.open(render_preview(tmp_path, out_name="p2.png", px_per_stud=1, max_px=32))
    assert max(tiny.size) == 32


def test_render_chunk_iso(tmp_path):
    r = world(tmp_path)
    out = render_chunk_iso(tmp_path / "chunks" / "c_02_03.bxc", tmp_path / "iso.png")
    img = np.asarray(Image.open(out))
    assert img.shape[0] > 20 and img.shape[1] > 20
    assert (img != img[0, 0]).any(axis=2).sum() > 50  # something was drawn
    out2 = render_chunk_iso(r[:1], tmp_path / "iso2.png", scale=4)
    assert out2.is_file()
