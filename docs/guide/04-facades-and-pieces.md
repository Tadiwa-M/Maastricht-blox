# 04: Facades and detail pieces

Spec: CONTRACT 2.1 (pieces 38-47) and CONTRACT 7 ("Placed pieces").
Code: `pipeline/src/blox_pipeline/facade/`. Used today by the look-test scene
(`testscene/scene.py`); real map data doesn't use it yet (it still paints glass cells).

## The facade grammar

A house is an axis-aligned box whose **street front faces −j** (so street pieces face `S`).
`HouseSpec` (`facade/spec.py`) says what it looks like; `paint_house` (`facade/walls.py`)
builds it.

```python
HouseSpec(x0=13, y0=45, width=12, depth=16, storeys=2, fid=11, wall="brick_red",
          trim="white", accent="dark_green", roof="roof_tile_dark",
          roof_kind=RoofKind.EAVE_DORMERS, ground=GroundFloor.ARCHED,
          shutters=True, flowers="flower_pink", balcony=True)
```

| Field | Choices |
|---|---|
| `roof_kind` | `STEPPED_GABLE` (ridge runs back, stepped gable to the street), `EAVE_DORMERS` (ridge parallel to the street, dormers), `FLAT_CORNICE` (flat roof, cornice, fence balustrade) |
| `ground` | `HOUSE` (plinth, door, windows), `SHOP` (shop windows, arched door, sign band, awning), `ARCHED` (every opening under an arch) |
| extras | `quoins`, `shutters`, `flowers` (first-floor window boxes), `balcony`, `corner_west` (windows on the west side wall) |

Vertical rhythm, in plates: plinth 3, ground floor 18, each upper storey 15.

### Rows along j, seen from the street

```
j = y0       trim layer: pilasters, sills, cornices, flower boxes (stick out)
j = wall_j   wall plane: window/door/arch pieces sit here      (y0 + 1)
j = glass_j  first interior row: dark "room" backdrops         (y0 + 2)
...          air up to the back wall
```

### Build order (`walls.py: paint_house`)

The order matters: placed pieces need air, and nothing may be painted over them later.

```
shell -> pilasters -> upper storeys -> ground floor -> west side windows -> eave cornice -> roof
         walls.py     windows.py       ground.py       windows.py           walls.py        roofs.py
```

### Module map

| File | What |
|---|---|
| `spec.py` | `HouseSpec`, `RoofKind`, `GroundFloor`, row and level helpers (`wall_j`, `floor_k`, `eave_k`) |
| `bays.py` | `bay_starts`: spreads 2-wide window bays evenly between the corner pilasters, the remainder going to the central gaps |
| `pieces.py` | small helpers that all do "clear → place facing S → paint what's behind": `window`, `door`, `arch_over`, `sloped_sill`, `flower_box`, `fence_run` |
| `windows.py` | an upper-storey bay (window + sill or flower box + lintel + shutters), balcony, west side windows (facing `W`) |
| `ground.py` | `house_front`, `shop_front` (awning + `grille_1x2` sign lettering), `arched_front` |
| `roofs.py` | stepped gable, eave roof with dormers (`window_1x2x2`), flat roof with `fence_1x4` balustrade, chimneys; slopes as 3-cell stacks (CONTRACT 7) |
| `props.py` | café table, planter, bench, bollard, street lamp (round tiles as flower heads and caps) |
| `painter.py` | the `Painter` protocol (`fill`, `clear`, `place`) the grammar needs; `testscene.Canvas` implements it |

Backdrops behind glass come from a hash of position and feature (`pieces.py: BACKDROPS`), so
rooms look different from window to window but stay stable between builds.

## The detail pieces (ids 38-47)

All are **placed** (never inferred from voxels). Directional ones have their decorated
front toward +j at rot 0. The whole bounding box counts as occupied for stud tests.

| id | name | w×d×h | Used for | Notes |
|---|---|---|---|---|
| 38 | `arch_1x4` | 4×1×3 | over shop doors and arched openings | opening is a half-ellipse under a lintel (see CONTRACT ISSUES in STATUS) |
| 39 | `arch_1x6` | 6×1×6 | (available, not used yet) | |
| 40 | `window_1x2x2` | 2×1×6 | dormers, bus and boat windows | frame 0.06 m bars, mullion, transom at 2/3, glass 0.1 m back |
| 41 | `window_1x2x3` | 2×1×9 | every storey window, boat cabin | |
| 42 | `door_1x2x4` | 2×1×12 | front doors, balcony doors, bus doors | leaf 0.06 m back, 4 raised panels, glass fanlight |
| 43 | `fence_1x4` | 4×1×3 | balustrades, balconies, boat rails | rails with studs, round spindles every 0.25 m |
| 44 | `round_tile_1x1` | 1×1×1 | flowers, bollard caps, lamp tops | no front, placed with `N` |
| 45 | `jumper_1x2` | 2×1×1 | top of stepped gables | one centred stud (`studs: center`) |
| 46 | `slope30_1x2` | 1×2×2 | window sills | shallow, no studs, 0.05 m lip |
| 47 | `grille_1x2` | 2×1×1 | shop sign "lettering" | 3 grooves on top |

Window and door panes always use the `glass` material, whatever the record colour; the record
colour is the frame. At night each window glows on its own (viewer `glow.js`; Unity uses the
brick seed in UV2.y).

Where the geometry is built:

| Renderer | File | Frame |
|---|---|---|
| viewer | `viewer/src/details.js` (`detailGeometry`), helpers in `shapes.js` | centred footprint, front −z |
| Unity | `Runtime/Meshing/Core/DetailMesher.cs` (pieces), `DetailParts.cs` (boxes, posts), `DetailShapes.cs` (sizes, `CoversLocal`) | rot-0 metres, front at z = d |

Both use the same numbers (bar 0.06 m, pane back 0.1 m, rail 0.1 m, spindle step 0.25 m).

## How to add a new piece end to end

Example: a `shutter_1x2x3`. Each step names the file to touch.

1. **Contract** (needs a version bump and every component updated, CLAUDE.md):
   - append an entry to `contract/brick_catalogue.json` (ids are append-only), with `kind`,
     `w`, `d`, `h`, `studs`;
   - describe its geometry in the CONTRACT 2.1 table, and say where its front is;
   - if it is a new `kind`, add it to the list in CONTRACT 2.
2. **Pipeline**
   - `catalogue.py`: add a new kind to `DETAIL_KINDS`.
   - `layout/verify.py` needs no change: any kind outside `KIND_CODE` is treated as
     `DETAIL_CODE`, which is valid only as a placed piece.
   - Use it from the grammar with `cv.place("shutter_1x2x3", i, j, k, "S", colour, fid)`,
     usually inside a helper in `facade/pieces.py` that clears the cells first.
   - Tests: `tests/test_catalogue.py` (loads, stud offsets), `tests/test_facade.py` (faces S,
     air in front and wall behind, layout verifies).
3. **Viewer**
   - `src/details.js`: add a `case` in `detailGeometry` that returns `{ body, glass? }`,
     built in the local frame (centred, front toward −z).
   - `src/gallery.js`: add a colour in `COLOR_BY_KIND` so the gallery shows it.
   - Check it by eye: `node screenshot.mjs ../build/shots gallery ids=48`. The decorated side
     must look at the yellow marker for all four facings.
4. **Unity**
   - `Runtime/Data/Contract/Catalogue.cs`: add a `BrickKind` value, parse its `kind` string,
     and include it in `IsDetail`.
   - `Runtime/Meshing/Core/DetailMesher.cs`: add a `case` in `Emit`, built in the rot-0
     metre frame (front at z = d), from `DetailParts` building blocks.
   - `Runtime/Meshing/Core/DetailShapes.cs`: its sizes, and in `CoversLocal` which cell faces
     it closes (that drives face culling of its neighbours).
   - Tests: `dotnet/Blox.Tests/DetailMesherTests.cs` (every rotation; closed, outward-facing
     geometry; glass panes in submesh 1).
5. **Regenerate and look:** `scripts/shots.sh`, then `scripts/check.sh`.
6. **Docs:** add a row to the table above and an entry in `docs/DEVLOG.md`.
