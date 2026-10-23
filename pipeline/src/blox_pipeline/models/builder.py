"""``ModelBuilder``: assemble a brick model (CONTRACT 7.1) piece by piece.

A model is a little brick world of its own: local cells ``(i, j, k)``, every brick a
record (min corner of its turned box + ``rot``), facing ``+j`` as "forward". Movers turn
the whole model by its pose yaw, so inside a model you only ever think "front = +j".

Two ways to add bricks, mirroring the city tooling:

* ``place(piece, i, j, k, facing, colour)`` puts one catalogue piece, turned by facing;
* ``box(i0, i1, j0, j1, k0, k1, colour)`` fills the *still empty* cells of a box
  greedily with bricks and plates laid lengthwise along j (long pieces first). So the
  usual recipe is: place the special pieces (wheels, windows, doors) first, then pour
  the body around them with ``box``.

Every add checks the model's bounds and that no two bricks share a cell.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..catalogue import Catalogue, load_catalogue
from ..palette import Palette, load_palette
from ..rotation import Facing, facing_to_rot, footprint_cells

LENGTHS = (8, 6, 4, 3, 2, 1)  # longest first, along j
BRICK = 3


@dataclass
class Part:
    pivot: tuple[float, float, float]


@dataclass
class ModelBuilder:
    name: str
    size: tuple[int, int, int]               # studs along i, j; plates along k
    pivot: tuple[float, float, float]        # model origin in local cells (ground centre)
    catalogue: Catalogue = field(default_factory=load_catalogue)
    palette: Palette = field(default_factory=load_palette)
    bricks: list[dict[str, Any]] = field(default_factory=list)
    parts: dict[str, Part] = field(default_factory=dict)
    _taken: dict[tuple[int, int, int], int] = field(default_factory=dict)

    def part(self, name: str, pivot: tuple[float, float, float]) -> str:
        """Declare an animated group; returns the name to pass as ``part=``."""
        self.parts[name] = Part(pivot)
        return name

    def place(self, piece: str, i: int, j: int, k: int, facing: Facing | str, colour: str,
              part: str | None = None) -> None:
        t = self.catalogue[piece]
        rot = facing_to_rot(facing)
        cells = [(i + di, j + dj, k + dk) for _, _, di, dj in footprint_cells(t.w, t.d, rot)
                 for dk in range(t.h)]
        for c in cells:
            if not all(0 <= c[n] < self.size[n] for n in range(3)):
                raise ValueError(f"{self.name}: {piece} at {(i, j, k)} leaves the model box {self.size}")
            if c in self._taken:
                raise ValueError(f"{self.name}: {piece} at {(i, j, k)} overlaps brick #{self._taken[c]}")
        if part is not None and part not in self.parts:
            raise ValueError(f"{self.name}: undeclared part {part!r}")
        for c in cells:
            self._taken[c] = len(self.bricks)
        rec: dict[str, Any] = {"i": i, "j": j, "k": k, "type": t.id,
                               "color": self.palette.idx(colour), "rot": rot}
        if part:
            rec["part"] = part
        self.bricks.append(rec)

    def box(self, i0: int, i1: int, j0: int, j1: int, k0: int, k1: int, colour: str,
            part: str | None = None, top: str = "plate") -> None:
        """Fill the free cells of ``[i0,i1) x [j0,j1) x [k0,k1)``: bricks where 3 free
        plates fit, plates elsewhere (tiles on the last layer when ``top="tile"``)."""
        solid_top = k1 - 1 if top == "tile" else k1  # bricks/plates stay below the tile layer
        for k in range(k0, k1):
            for j in range(j0, j1):
                for i in range(i0, i1):
                    if (i, j, k) in self._taken:
                        continue
                    kinds = ["brick"] if k + BRICK <= solid_top else []
                    kinds.append("tile" if k >= solid_top else "plate")
                    name = self._best_fit(kinds, i, i1, j, j1, k)
                    self.place(name, i, j, k, "N", colour, part)

    def _best_fit(self, kinds: list[str], i: int, i1: int, j: int, j1: int, k: int) -> str:
        """Largest piece (2-wide before 1-wide, long before short) whose cells are free."""
        for kind in kinds:
            h = BRICK if kind == "brick" else 1
            for wide in (2, 1):
                for n in LENGTHS:
                    name = f"{kind}_{wide}x{n}"
                    if name in self.catalogue and i + wide <= i1 and j + n <= j1 and all(
                        (a, b, c) not in self._taken
                        for a in range(i, i + wide) for b in range(j, j + n) for c in range(k, k + h)
                    ):
                        return name
        raise AssertionError("a free cell always fits a 1x1 plate")

    def document(self) -> dict[str, Any]:
        """The JSON document of CONTRACT 7.1 (bricks sorted by k, j, i)."""
        bricks = sorted(self.bricks, key=lambda b: (b["k"], b["j"], b["i"]))
        return {
            "name": self.name, "version": 1, "size": list(self.size),
            "pivot": list(self.pivot), "forward": "+j",
            "parts": {n: {"pivot": list(p.pivot)} for n, p in sorted(self.parts.items())},
            "bricks": bricks,
        }
