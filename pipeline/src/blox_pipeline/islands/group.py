"""Pick the buildings that become islands and group terraces (CONTRACT 5.1).

* A building whose dominant wall is more than ``MIN_YAW_DEG`` (3 deg) off the world grid is
  an island candidate. At 3 deg or less, a 10 m wall drifts at most 0.5 m (one stud), so the
  world grid still rasterises it as a straight wall and it stays in the chunks.
* Touching candidates (a shared or near-shared edge: at least ``SHARED_MIN_M`` of one
  footprint's outline within ``TOUCH_M`` of the other) whose yaws differ by at most 3 deg are
  one group: a terrace on one rotated grid, so party walls line up and there are no slits.
  Pairs merge strongest contact first and only while the whole group's yaws stay within
  3 deg, so a slowly curving street does not chain into one huge island.
* A group's yaw is the length-weighted dominant direction of all its members' edges.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from shapely import STRtree

from .. import geo
from ..voxelise.world import PreparedBuilding
from .orient import dominant_angle, edges, footprint_yaw, wrap90, yaw_diff

MIN_YAW_DEG = 3.0
GROUP_YAW_DEG = 3.0
TOUCH_M = 0.5
SHARED_MIN_M = 2.0  # a corner contact gives at most ~1.4 m within TOUCH_M; party walls are longer


@dataclass
class IslandGroup:
    members: list[PreparedBuilding]
    yaw_deg: float

    @property
    def fids(self) -> tuple[int, ...]:
        return tuple(b.feature_id for b in self.members)

    def top_k(self, b: PreparedBuilding) -> int:
        """Highest roof level of a member (occupancy for neighbours' window checks)."""
        zs = [p.z_at(np.asarray(p.poly.exterior.coords)[:, 0], np.asarray(p.poly.exterior.coords)[:, 1]).max()
              for p in b.roofs if hasattr(p.poly, "exterior")]
        return geo.z_to_k(max(zs)) if zs else geo.z_to_k(max(p.origin[2] for p in b.roofs))


def group_yaw(members: list[PreparedBuilding]) -> float:
    parts = [edges(b.footprint) for b in members]
    a = np.concatenate([p[0] for p in parts]) if parts else np.zeros(0)
    ln = np.concatenate([p[1] for p in parts]) if parts else np.zeros(0)
    return wrap90(-dominant_angle(a, ln))


def plan_islands(buildings: list[PreparedBuilding], min_yaw: float = MIN_YAW_DEG
                 ) -> tuple[list[IslandGroup], list[PreparedBuilding]]:
    """Split ``buildings`` into island groups and the ones that stay on the world grid."""
    yaws = [footprint_yaw(b.footprint)[0] for b in buildings]
    cand = [n for n, y in enumerate(yaws) if abs(y) > min_yaw]
    if not cand:
        return [], list(buildings)
    tree = STRtree([buildings[n].footprint for n in cand])
    pairs = []
    for a, n in enumerate(cand):
        fa = buildings[n].footprint
        near = fa.buffer(TOUCH_M)
        for b in tree.query(near):
            m = cand[int(b)]
            if m <= n or yaw_diff(yaws[n], yaws[m]) > GROUP_YAW_DEG:
                continue
            shared = max(near.intersection(buildings[m].footprint.boundary).length,
                         buildings[m].footprint.buffer(TOUCH_M).intersection(fa.boundary).length)
            if shared >= SHARED_MIN_M:
                pairs.append((-shared, n, m))
    parent = {n: n for n in cand}
    members = {n: [n] for n in cand}

    def find(n: int) -> int:
        while parent[n] != n:
            parent[n] = parent[parent[n]]
            n = parent[n]
        return n

    for _, n, m in sorted(pairs):
        rn, rm = find(n), find(m)
        if rn == rm:
            continue
        joined = members[rn] + members[rm]
        if all(yaw_diff(yaws[p], yaws[q]) <= GROUP_YAW_DEG for p in joined for q in joined):
            parent[rm] = rn
            members[rn] = joined
            del members[rm]
    groups = []
    for root in sorted(members, key=lambda r: min(buildings[n].feature_id for n in members[r])):
        ms = sorted((buildings[n] for n in members[root]), key=lambda b: b.feature_id)
        yaw = group_yaw(ms) if len(ms) > 1 else yaws[members[root][0]]
        groups.append(IslandGroup(ms, yaw))
    on_grid = [b for n, b in enumerate(buildings) if n not in parent]
    return groups, on_grid


__all__ = ["IslandGroup", "MIN_YAW_DEG", "group_yaw", "plan_islands"]
