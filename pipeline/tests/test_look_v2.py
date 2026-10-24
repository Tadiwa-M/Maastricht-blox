"""Look v2 (owner's Markt photos, ``docs/reference/markt.md``): palette and pieces, old-centre
colours and facade style, the look-v2 facade grammar, plane trees, street props, dormers on
real roofs and the Stadhuis hero model on the real-data path (on the grid and as an island)."""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pytest

from blox_pipeline import geo
from blox_pipeline.catalogue import load_catalogue
from blox_pipeline.facade import GroundFloor, HouseSpec, RoofKind, paint_house
from blox_pipeline.facade.frame import DIRS, Frame, FramePainter
from blox_pipeline.facade.run import FacadeRun, paint_run
from blox_pipeline.facade.stadhuis import model_height
from blox_pipeline.layout import layout_tile, verify_layout
from blox_pipeline.layout.placed import placed_box
from blox_pipeline.palette import load_palette
from blox_pipeline.rotation import rot_to_facing
from blox_pipeline.sources import load_all
from blox_pipeline.testscene.canvas import Canvas
from blox_pipeline.voxelise import VoxelConfig, iter_chunk_tiles, palette, prepare_world
from blox_pipeline.voxelise.colours import old_centre, roof_colour, wall_colour
from blox_pipeline.voxelise.facade_style import facade_style
from blox_pipeline.voxelise.trees import tree_cells
from blox_pipeline.voxelise.world import TreeSpec

sys.path.insert(0, str(Path(__file__).parent))
import markt_fixture as markt  # noqa: E402
from test_facade_frame import DictPainter  # noqa: E402

CAT = load_catalogue()
NEW_PIECES = {"window_1x2x4": ("window", 2, 1, 12), "shop_window_1x2x4": ("window", 2, 1, 12),
              "balcony_2x4": ("fence", 4, 2, 5), "railing_1x2": ("fence", 2, 1, 4),
              "pediment_1x4": ("arch", 4, 1, 2), "lamp_double_1x3": ("fence", 3, 1, 22),
              "bollard_1x1": ("fence", 1, 1, 5), "chain_1x4": ("fence", 4, 1, 3),
              "vent_1x2": ("tile_grille", 2, 1, 2)}
NEW_COLOURS = ("limestone", "limestone_dark", "plaster_white", "plaster_cream", "plaster_grey",
               "cobble_dark", "lead_grey")
G = 20


# ---- contract ---------------------------------------------------------------------------

def test_new_pieces_are_appended_with_existing_kinds():
    ids = [t.id for t in CAT.types]
    assert ids == list(range(1, len(ids) + 1))
    for name, (kind, w, d, h) in NEW_PIECES.items():
        t = CAT[name]
        assert t.id >= 48 and (t.kind, t.w, t.d, t.h) == (kind, w, d, h) and t.is_detail


def test_new_colours_are_appended():
    pal = load_palette()
    for name in NEW_COLOURS:
        assert pal[name].idx >= 47 and pal[name].material == "solid"
    assert len(pal.entries) <= 64 and pal.version >= 3


# ---- colours and style ------------------------------------------------------------------

def test_old_centre_by_distance_or_year():
    assert old_centre(176430.0, 318007.0, 1975)          # the Markt
    assert old_centre(176185.0, 317717.0, None)          # the Vrijthof
    assert not old_centre(178500.0, 316600.0, 1960)      # far out, post-war
    assert old_centre(178500.0, 316600.0, 1880)          # far out, but old


def test_centre_is_limestone_and_plaster_under_slate():
    ids = [f"NL.IMBAG.Pand.{n:016d}" for n in range(400)]
    walls = Counter(wall_colour(i, 1750, centre=True) for i in ids)
    assert walls["limestone"] + walls["plaster_white"] + walls["plaster_cream"] + walls["plaster_grey"] > 0.75 * 400
    brick = sum(v for k, v in walls.items() if k.startswith("brick"))
    assert 0 < brick < 0.15 * 400 and walls["ochre"] == 0
    roofs = Counter(roof_colour(i, 1750, True, centre=True) for i in ids)
    assert roofs["slate"] > 0.75 * 400
    # elsewhere the era variety stays: inter-war brick
    assert all(wall_colour(i, 1930).startswith("brick") for i in ids[:50])


def test_centre_style_is_the_maastricht_townhouse():
    styles = [facade_style(f"NL.IMBAG.Pand.{n:016d}", 1800, "plaster_white", centre=True) for n in range(200)]
    assert all(s.window == "window_1x2x4" and s.surrounds and s.vents and s.stone == "limestone" for s in styles)
    assert all(s.trim == "white" and not s.shutters for s in styles)
    assert sum(s.door == "white" for s in styles) > 0.6 * 200
    assert 0.2 * 200 < sum(s.iron_balcony for s in styles) < 0.6 * 200
    assert any(s.pediments for s in styles)
    # outside the centre a 1800 house keeps the v2 style
    assert facade_style("NL.IMBAG.Pand.0000000000000001", 1800, "brick_red").window == "window_1x2x3"


# ---- grammar ----------------------------------------------------------------------------

LOOK = dict(trim="white", window="window_1x2x4", shop_window="shop_window_1x2x4", surrounds=True, vents=True,
            pier=2, roof="slate", stone="limestone", plinth="limestone", door="white", dormer="plaster_white")


def _house(ground: GroundFloor, roof: RoofKind, **kw) -> tuple[Canvas, np.ndarray]:
    cv = Canvas(0, 0, k0=G - 3, nz=120)
    cv.fill(0, 64, 0, 64, G - 3, G, "cobble_dark", shape=7)
    spec = HouseSpec(4, 10, 14, 14, 3, 5, "plaster_white", roof_kind=roof, ground=ground, **(LOOK | kw))
    paint_house(cv, spec, G)
    placed = cv.placed_records()
    rec = layout_tile(cv.color, cv.feature, cv.shape, cv.k0, cv.I0, cv.J0, placed=placed)
    assert verify_layout(cv.color, cv.feature, cv.shape, rec, cv.k0, cv.I0, cv.J0, placed=placed) == []
    return cv, rec


@pytest.mark.parametrize("ground", [GroundFloor.HOUSE, GroundFloor.SHOP])
@pytest.mark.parametrize("extras", [dict(balcony=True, iron_balcony=True, french=True), dict(pediments=True)])
def test_look_v2_houses_lay_out_and_face_the_street(ground, extras):
    cv, rec = _house(ground, RoofKind.EAVE_DORMERS, **extras)
    names = Counter(CAT[int(t)].name for t in rec["type"])
    assert names["window_1x2x4"] >= 2 and names["door_1x2x4"] >= 1 and names["vent_1x2"] >= 1
    if ground is GroundFloor.SHOP:
        assert names["shop_window_1x2x4"] >= 2 and names["grille_1x2"] >= 2
    if extras.get("iron_balcony"):
        assert names["balcony_2x4"] == 1 and names["railing_1x2"] >= 1
    if extras.get("pediments"):
        assert names["pediment_1x4"] >= 2
    # every look-v2 piece of the front faces the street (S) with air in front of it
    look = {CAT.id(n) for n in NEW_PIECES}
    for row in cv.placed_records():
        if int(row["type"]) not in look:
            continue
        assert rot_to_facing(int(row["rot"]) & 3).name == "S"
        i0, i1, j0, _, k0, k1 = placed_box(CAT, row)
        assert cv.color[i0 + 1, j0, (k0 + k1) // 2 - cv.k0] == 0  # the cell south of it (rim offset 1)
    # pediments never overlap (a 1-stud pier between two 4-wide pediments)
    peds = [placed_box(CAT, r) for r in cv.placed_records() if CAT[int(r["type"])].name == "pediment_1x4"]
    assert all(a[1] <= b[0] for a, b in zip(sorted(peds), sorted(peds)[1:]))


def test_white_dormers_on_slate():
    cv, _ = _house(GroundFloor.HOUSE, RoofKind.EAVE_DORMERS)
    names = {cv.palette[int(c)].name for c in np.unique(cv.color)}
    assert {"plaster_white", "slate", "limestone"} <= names


@pytest.mark.parametrize("normal", ["N", "E", "S", "W"])
def test_frame_turns_the_look_v2_grammar_rigidly(normal):
    run = FacadeRun(x0=0, x1=14, y0=0, storeys=2, fid=3, wall="plaster_white", ground=GroundFloor.SHOP,
                    balcony=True, iron_balcony=True, french=True, eave_extra=2, **{k: v for k, v in LOOK.items() if k not in ("roof", "plinth", "dormer")})
    ref, out = DictPainter(), DictPainter()
    for cv in (ref, FramePainter(out, Frame(normal, 100, 200))):
        cv.fill(0, 14, 1, 4, G, run.eave_k(G), "plaster_white", 3)
        paint_run(cv, run, G)
    assert len(ref.pieces) == len(out.pieces) and len(ref.cells) == len(out.cells)
    want = Frame(normal, 0, 0).direction("S")
    assert {p[4] for p in out.pieces if p[0] in NEW_PIECES} == {want}
    assert {p[0] for p in ref.pieces} >= {"window_1x2x4", "shop_window_1x2x4", "balcony_2x4", "vent_1x2"}


# ---- trees ------------------------------------------------------------------------------

@pytest.mark.parametrize("seed", [1, 77, 12345])
def test_plane_trees_have_bare_trunks_and_irregular_crowns(seed):
    t = TreeSpec(100, 200, 12.0, 4.5, palette.idx("leaf"), palette.idx("leaf_light"), seed)
    I, J, K, C = tree_cells(t, 50)
    leaf = C != palette.idx("trunk")
    assert int(K[leaf].min()) - 51 >= 4.0 / geo.PLATE_M - 3        # >= ~4 m of bare trunk
    r = np.hypot(I[leaf] - 100, J[leaf] - 200)
    assert r.max() <= 4.5 / geo.STUD_M + 1e-9                        # stays inside crown_r
    widths = [len({(i, j) for i, j, k in zip(I[leaf], J[leaf], K[leaf]) if k == kk}) for kk in np.unique(K[leaf])]
    assert max(widths) > 100                                         # a large crown (> 25 m² across)
    a = tree_cells(t, 50)
    assert all(np.array_equal(x, y) for x, y in zip(a, (I, J, K, C)))  # deterministic
    # irregular: not mirror-symmetric
    cells = {(int(i) - 100, int(j) - 200, int(k)) for i, j, k in zip(I[leaf], J[leaf], K[leaf])}
    assert cells != {(-a, b, k) for a, b, k in cells}


# ---- the Markt fixture: real-data path ----------------------------------------------------

def _build(root):
    src = load_all(markt.LOAD, root)
    world = prepare_world(src, VoxelConfig(use_ortho_ground=False))
    return world


@pytest.fixture(scope="module")
def markt_world(tmp_path_factory):
    root = markt.write_data_dir(tmp_path_factory.mktemp("markt"))
    world = _build(root)
    hero = world.heroes[0]
    i0, i1, j0, j1 = hero.bbox()
    box = geo.CellBox(i0, j0, i1, j1)
    tiles = {}
    for cx, cy, tile in iter_chunk_tiles(world, box):
        rec = layout_tile(tile.color, tile.feature, tile.shape, tile.k0, tile.I0, tile.J0, border=1,
                          placed=tile.placed)
        tiles[(cx, cy)] = (tile, rec)
    return root, world, tiles


def test_stadhuis_is_matched_and_replaced_by_the_model(markt_world):
    _, world, tiles = markt_world
    assert len(world.heroes) == 1
    h = world.heroes[0]
    assert h.model == "stadhuis" and (h.w, h.d) == (92, 76)
    assert all(b.feature_id != h.fid for b in world.buildings)            # not voxelised from 3D BAG
    names = Counter()
    top = 0
    for (cx, cy), (t, rec) in tiles.items():
        assert verify_layout(t.color, t.feature, t.shape, rec, t.k0, t.I0, t.J0, border=1, placed=t.placed) == []
        for row in rec:
            i0, i1, j0, j1, _, k1 = placed_box(CAT, row)
            assert (i0 // 64, (i1 - 1) // 64, j0 // 64, (j1 - 1) // 64) == (cx, cx, cy, cy)
        names.update(CAT[int(x)].name for x in rec["type"][rec["featureId"] == h.fid])
        own = rec[rec["featureId"] == h.fid]
        if len(own):
            top = max(top, int((own["K"] + np.array([CAT[int(x)].h for x in own["type"]])).max()))
    assert names["window_1x2x4"] >= 40 and names["window_1x2x2"] >= 40 and names["vent_1x2"] >= 10
    assert names["arch_1x6"] + 0 >= 1 and names["fence_1x4"] >= 4 and names["door_1x2x4"] >= 1
    assert top >= h.top_k - 2 and h.top_k == h.base + model_height(h.w, h.d)
    gold = palette.idx("gold")
    assert any(((t.color == gold) & (t.feature == h.fid)).any() for t, _ in tiles.values())  # clock + vane


def test_streets_get_props_kerbs_and_dark_cobbles(markt_world):
    _, world, _ = markt_world
    kinds = Counter(p.kind for p in world.props)
    assert kinds["lamp"] >= 10 and kinds["bench"] >= 5 and kinds["chain"] >= 3
    assert kinds["bollard"] == 2 * kinds["chain"]
    fps = [b.footprint for b in world.buildings] + [h.footprint for h in world.heroes]
    from shapely.geometry import box as shp_box
    for p in world.props:
        i0, i1, j0, j1 = p.box()
        assert i0 // 64 == (i1 - 1) // 64 and j0 // 64 == (j1 - 1) // 64
        cell = shp_box(geo.X0 + i0 * 0.5, geo.Y0 + j0 * 0.5, geo.X0 + i1 * 0.5, geo.Y0 + j1 * 0.5)
        assert not any(fp.intersects(cell) for fp in fps)
    # chains hang between their two bollards, two plates up
    by = {(p.I, p.J): p for p in world.props if p.kind == "bollard"}
    for c in (p for p in world.props if p.kind == "chain"):
        ends = [(c.I - 1, c.J), (c.I + 4, c.J)] if c.facing == "N" else [(c.I, c.J - 1), (c.I, c.J + 4)]
        assert all(e in by for e in ends) and c.k == max(by[e].k for e in ends) + 2


def test_south_terrace_gets_dormers_and_balconies(markt_world):
    _, world, _ = markt_world
    south = [r for r in world.facades if r.detail and r.normal == "N"]
    assert south and sum(len(r.dormers) for r in south) >= 4
    assert any(r.run.iron_balcony and r.run.balcony for r in south)
    assert all(r.run.window == "window_1x2x4" for r in south)


def test_stadhuis_turned_12_degrees_is_built_on_its_island(tmp_path):
    from blox_pipeline.islands.build import build_group

    root = markt.write_data_dir(tmp_path, stadhuis_deg=12.0)
    world = _build(root)
    assert not world.heroes                                    # not on the world grid ...
    group = next(g for g in world.islands if any(b.hero for b in g.members))
    res = build_group(world, group, keep_tiles=True)           # ... but on its own turned grid
    names = Counter(CAT[int(x)].name for _, rec in res.tiles for x in rec["type"])
    assert names["window_1x2x4"] >= 40 and names["fence_1x4"] >= 4
    for t, rec in res.tiles:
        assert verify_layout(t.color, t.feature, t.shape, rec, t.k0, t.I0, t.J0, border=1, placed=t.placed) == []
    recs = np.concatenate([r for _, r in res.tiles if len(r)])
    assert int(recs["I"].min()) >= 0 and int(recs["J"].min()) >= 0   # the perron stays on the island
