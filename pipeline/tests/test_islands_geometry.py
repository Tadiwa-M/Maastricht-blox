"""Island pose (shared vectors), orientation estimate and terrace grouping (CONTRACT 5.1)."""

from __future__ import annotations

import json
import math

import numpy as np
import pytest
from shapely import affinity
from shapely.geometry import Point, Polygon, box as shp_box

from blox_pipeline import geo
from blox_pipeline.catalogue import repo_root
from blox_pipeline.islands.group import plan_islands
from blox_pipeline.islands.orient import dominant_angle, edges, footprint_yaw, wrap90, yaw_diff
from blox_pipeline.islands.pose import IslandPose, island_local_to_world, island_world_to_local
from blox_pipeline.voxelise.world import PreparedBuilding

VECTORS = json.loads((repo_root() / "contract" / "test_vectors" / "islands.json").read_text())


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda c: f"{c['origin']}@{c['yawDeg']}")
def test_shared_island_vectors(case):
    for u, v, x, z in case["points"]:
        gx, gz = island_local_to_world(tuple(case["origin"]), case["yawDeg"], u, v)
        assert gx == pytest.approx(x, abs=1e-5) and gz == pytest.approx(z, abs=1e-5)
        bu, bv = island_world_to_local(tuple(case["origin"]), case["yawDeg"], x, z)
        assert bu == pytest.approx(u, abs=1e-5) and bv == pytest.approx(v, abs=1e-5)


@pytest.mark.parametrize("yaw", [-44.0, -20.0, 0.0, 12.25, 45.0])
def test_affine_matrices_match_the_pose(yaw):
    pose = IslandPose((485.0, 1217.0), yaw)
    for u, v in ((0.0, 0.0), (10.0, 4.0), (127.5, 127.5)):
        x, z = pose.to_world(u, v)
        rd = Point(x + geo.X0, z + geo.Y0)
        loc = affinity.affine_transform(rd, pose.local_affine())
        assert (loc.x - geo.X0, loc.y - geo.Y0) == pytest.approx((u, v), abs=1e-6)
        back = affinity.affine_transform(loc, pose.world_affine())
        assert (back.x, back.y) == pytest.approx((rd.x, rd.y), abs=1e-6)


def test_offset_moves_origin_along_local_axes():
    pose = IslandPose((100.0, 200.0), 30.0)
    moved = pose.offset(128.0, 0.0)
    assert moved.yaw_deg == 30.0
    assert moved.to_world(0.0, 0.0) == pytest.approx(pose.to_world(128.0, 0.0))
    assert moved.to_world(3.0, 5.0) == pytest.approx(pose.to_world(131.0, 5.0))


def test_local_plus_j_points_along_yaw():
    """yaw clockwise from north: at 90 deg local +j would point east (same as model poses)."""
    x, z = island_local_to_world((0.0, 0.0), 30.0, 0.0, 1.0)
    assert (x, z) == pytest.approx((math.sin(math.radians(30)), math.cos(math.radians(30))))


def test_wrap90():
    assert wrap90(0) == 0 and wrap90(90) == 0 and wrap90(-45) == 45 and wrap90(45) == 45
    assert wrap90(100) == pytest.approx(10) and wrap90(-100) == pytest.approx(-10) and wrap90(50) == pytest.approx(-40)
    assert yaw_diff(44, -44) == pytest.approx(2) and yaw_diff(10, 13) == pytest.approx(3)


@pytest.mark.parametrize("deg", [-44.0, -30.0, -20.0, -2.0, 0.0, 2.0, 17.5, 30.0, 44.0])
def test_footprint_yaw_of_turned_rectangles(deg):
    fp = affinity.rotate(shp_box(0, 0, 14, 9), deg, origin=(0, 0))
    yaw, length = footprint_yaw(fp)
    assert yaw_diff(yaw, -deg) < 1e-6
    assert length == pytest.approx(46.0)


def test_dominant_angle_ignores_a_chamfer_and_a_bay():
    """A 45 deg chamfer and a small skewed bay must not pull the 20 deg answer."""
    ring = [(0, 0), (20, 0), (20, 8), (17, 11), (0, 11), (0, 6), (-1, 5.5), (-1, 3), (0, 2)]
    fp = affinity.rotate(Polygon(ring), 20, origin=(0, 0))
    a, ln = edges(fp)
    assert dominant_angle(a, ln) == pytest.approx(20.0, abs=0.3)
    plain_mean = math.degrees(math.atan2((ln * np.sin(np.radians(4 * a))).sum(), (ln * np.cos(np.radians(4 * a))).sum())) / 4
    assert abs(plain_mean - 20.0) > abs(dominant_angle(a, ln) - 20.0)  # the plain mean is dragged


def bld(fid: int, geom) -> PreparedBuilding:
    return PreparedBuilding(feature_id=fid, bag_id=f"B{fid}", footprint=geom, roofs=[], wall=1,
                            roof_pitched=1, roof_flat=1, window_period=2, window_offset=0)


def turned(x0: float, x1: float, deg: float, depth: float = 10.0, centre=(0.0, 0.0)):
    return affinity.rotate(shp_box(x0, 0, x1, depth), deg, origin=centre)


def test_terrace_groups_and_near_grid_stays():
    blds = [bld(1, turned(0, 6, 20)), bld(2, turned(6, 13, 20.5)), bld(3, turned(13, 19, 19.8)),
            bld(4, affinity.translate(turned(0, 8, 2), 60, 0)),     # 2 deg: on the grid
            bld(5, affinity.translate(turned(0, 8, 0), 90, 0))]
    groups, grid = plan_islands(blds)
    assert [g.fids for g in groups] == [(1, 2, 3)]
    assert groups[0].yaw_deg == pytest.approx(-20.0, abs=0.5)
    assert {b.feature_id for b in grid} == {4, 5}


def test_different_angles_or_corner_contact_make_separate_islands():
    a = turned(0, 6, 20)
    b = turned(6, 13, 28)                                      # touching, 8 deg apart
    c = affinity.translate(turned(0, 6, 20), 6 * math.cos(math.radians(20)) * 2, 30)  # far away
    corner = affinity.rotate(shp_box(-6, -10, 0, 0), 20, origin=(0, 0))  # meets ``a`` at one corner
    groups, grid = plan_islands([bld(1, a), bld(2, b), bld(3, c), bld(4, corner)])
    assert sorted(g.fids for g in groups) == [(1,), (2,), (3,), (4,)]
    assert grid == []


def test_near_shared_edges_within_half_a_metre_join():
    a = turned(0, 6, -25)
    b = turned(6.4, 12, -25)  # 0.4 m gap: survey noise between two terrace houses
    groups, _ = plan_islands([bld(1, a), bld(2, b)])
    assert [g.fids for g in groups] == [(1, 2)]


def test_slowly_curving_street_does_not_chain_into_one_island():
    """Each neighbour is within 3 deg, but the whole row turns 10 deg: groups stay within 3."""
    blds, x = [], 0.0
    for n in range(6):
        blds.append(bld(n + 1, turned(x, x + 6, 10 + 2 * n, centre=(x, 0))))
        x += 6
    groups, _ = plan_islands(blds)
    for g in groups:
        yaws = [footprint_yaw(b.footprint)[0] for b in g.members]
        assert max(yaw_diff(p, q) for p in yaws for q in yaws) <= 3.0 + 1e-9
    assert len(groups) >= 2


def test_plinth_never_overwrites_placed_pieces() -> None:
    """Regression (real Maastricht build): on sloping ground a door piece sat where the plinth
    goes, and layout rejected the tile ("placed cells are not air")."""
    import numpy as np

    from blox_pipeline.islands.build import strip_ground
    from blox_pipeline.layout.placed import make_placed
    from blox_pipeline.voxelise.grid import VoxelTile
    from blox_pipeline.voxelise.layers import Layers
    from blox_pipeline.geo import CellBox

    box = CellBox(0, 0, 4, 4)
    L = Layers.empty(box)
    L.ground_k[:] = 5
    L.bld_top[:] = 20
    L.bld_feat[:] = 7
    L.bld_wall[:] = 3
    tile = VoxelTile.empty(0, 0, 0, 4, 4, 30)
    tile.color[:, :, 6:20] = 3
    tile.feature[:, :, 6:20] = 7
    from blox_pipeline.catalogue import load_catalogue

    tile.color[1:3, 1, 5:17] = 0                     # the door's cells, starting in the plinth layer
    tile.feature[1:3, 1, 5:17] = 0
    tile.placed = make_placed(load_catalogue(), "door_1x2x4", 1, 1, 5, "S", 3, 7)
    strip_ground(tile, L)
    assert tile.color[1, 1, 5] == 0 and tile.color[2, 1, 5] == 0   # door cells stay air
    assert tile.color[0, 0, 5] == 3 and tile.color[0, 0, 4] == 3   # plinth elsewhere
