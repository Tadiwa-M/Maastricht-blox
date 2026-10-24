# 04: Facades and detail pieces

Spec: CONTRACT 2.1 (pieces 38-56) and CONTRACT 7 ("Placed pieces"). Look v2 (the owner's
Markt photos, `docs/reference/markt.md`): see [Look v2](#look-v2-the-old-centre-from-the-photos).
Code: `pipeline/src/blox_pipeline/facade/` (the grammar) and, for real buildings,
`pipeline/src/blox_pipeline/voxelise/facade_*.py` + `streets.py`. Two callers share one
painter: the look-test scene (`testscene/scene.py`) and every real 3D BAG building whose
walls lie on the grid (see [Real buildings](#real-buildings-3d-bag)).

## The facade grammar

The unit of the grammar is a **facade run**: one straight wall of one building with one
outward normal, a length in studs, a ground-floor line, an eave, and a style.
`FacadeRun` (`facade/run.py`) describes it and `paint_run` paints it:

```
corner pilasters -> upper storeys -> ground floor -> eave cornice
run.py              windows.py       ground.py       run.py
```

It paints in a **run frame**: `x` along the wall, `y` inward, the outside at −y, so its
pieces face `S` in the frame. `FramePainter` (`facade/frame.py`) maps the frame onto the grid
for any outward normal (a rotation, never a mirror), turning boxes, facings and slope
shape codes with it:

| outward normal | frame x | frame y (inward) |
|---|---|---|
| `S` (−j) | +i | +j |
| `E` (+i) | +j | −i |
| `N` (+j) | −i | −j |
| `W` (−i) | −j | +i |

So a window placed facing `S` in the frame faces the wall's real outward direction, and
`tests/test_facade_frame.py` checks that a run painted through each frame is exactly the
`S` result turned (cells, slopes, piece boxes and facings).

### Test-scene houses

A house is an axis-aligned box whose **street front faces −j** (so street pieces face `S`).
`HouseSpec` (`facade/spec.py`) says what it looks like; `paint_house` (`facade/walls.py`)
builds it, with its front as a run (`HouseSpec.front_run()`, the grid is its frame).

```python
HouseSpec(x0=13, y0=45, width=12, depth=16, storeys=2, fid=11, wall="brick_red",
          trim="white", accent="dark_green", roof="roof_tile_dark",
          roof_kind=RoofKind.EAVE_DORMERS, ground=GroundFloor.ARCHED,
          shutters=True, flowers="flower_pink", balcony=True)
```

| Field | Choices |
|---|---|
| `roof_kind` | `STEPPED_GABLE` (ridge runs back, stepped gable to the street), `EAVE_DORMERS` (ridge parallel to the street, dormers), `FLAT_CORNICE` (flat roof, cornice, fence balustrade) |
| `ground` | `HOUSE` (plinth, door, windows), `SHOP` (shop windows, arched door, sign band, awning), `ARCHED` (every opening under an arch), `PLAIN` (windows only: side and back walls of real buildings) |
| extras | `quoins`, `shutters`, `flowers` (first-floor window boxes), `balcony`, `corner_west` (windows on the west side wall) |

Vertical rhythm, in plates: plinth 3, ground floor 18, each upper storey 15.

### Rows along the run frame's y, seen from the street

```
y = y0 - 1   overhang row: cornice, awning slopes (outside the building)
y = y0       trim layer: pilasters, sills, bands, shutters, flower boxes (stick out)
y = wall_j   wall plane: window/door/arch pieces sit here      (y0 + 1)
y = glass_j  first interior row: dark "room" backdrops         (y0 + 2)
```

### Build order (`walls.py: paint_house`)

The order matters: placed pieces need air, and nothing may be painted over them later.

```
shell -> front run (pilasters, upper storeys, ground floor, eave cornice) -> west side windows -> roof
walls.py  run.py: paint_run                                                 windows.py           roofs.py
```

(Before 2026-10-19 the cornice came after the west windows; the two never touch, so the
look-test voxels are unchanged. The only look-test change of the run refactor: the shop
sign band's wall-plane row now stops inside the corner pilasters so it cannot wrap round a
corner, 8 cells, 4,245 -> 4,247 bricks, placed pieces identical.)

### Module map

| File | What |
|---|---|
| `spec.py` | `HouseSpec`, `RoofKind`, `GroundFloor`, the vertical rhythm (`PLINTH`, `GROUND_H`, `STOREY_H`), `front_run` |
| `run.py` | `FacadeRun` (a run in its frame; `bays()` and `free()` keep pieces off chunk borders), `paint_run`, pilasters, eave cornice |
| `frame.py` | `Frame` + `FramePainter`: run frame → grid for normals N/E/S/W |
| `bays.py` | `bay_starts`: spreads 2-wide window bays evenly between the corner pilasters, the remainder going to the central gaps |
| `pieces.py` | small helpers that all do "clear → place facing S (in the frame) → paint what's behind": `window`, `door`, `arch_over`, `sloped_sill`, `flower_box`, `fence_run` |
| `windows.py` | an upper-storey bay (window + sill or flower box + lintel + shutters), balcony, west side windows (facing `W`) |
| `ground.py` | `house_front`, `shop_front` (awning + `grille_1x2` sign lettering), `arched_front`, `plain_front` |
| `roofs.py` | stepped gable, eave roof with dormers (`window_1x2x2`), flat roof with `fence_1x4` balustrade, chimneys; slopes as 3-cell stacks (CONTRACT 7) |
| `props.py` | café table, planter, bench, bollard, street lamp (round tiles as flower heads and caps) |
| `painter.py` | the `Painter` protocol (`fill`, `clear`, `place`) the grammar needs; `testscene.Canvas` implements it |

Backdrops behind glass come from a hash of position and feature (`pieces.py: BACKDROPS`), so
rooms look different from window to window but stay stable between builds.

## Real buildings (3D BAG)

Code: `voxelise/facade_runs.py` (find and plan runs), `facade_style.py` (style per
building), `streets.py` (street context), `facade_paint.py` (paint into chunk tiles).
`prepare_world` plans every run once (`world.facades`); `voxelise_tile` paints the runs that
reach into its tile last (after trees); `blox build` passes `tile.placed` to
`layout_tile(placed=...)`. `--no-facades` (or `VoxelConfig.facade_detail=False`) switches it off.

### Run extraction

For each building (not a landmark, not a church), layers are built for its bounding box
+ 4 cells with the same `build_layers` the tiles use, so the planner sees exactly the cells
the voxeliser will fill (including which building wins where footprints overlap).

1. **Wall cells**: cells the building owns whose outward neighbour column (N/E/S/W) holds
   no building at all. Party walls and walls above a lower neighbour are not runs.
2. **Runs**: per normal, wall cells are grouped along their row (rows of j for N/S, columns
   of i for E/W) into maximal straight runs of consecutive cells.
3. **Eligibility** (else `reason`, and the run keeps the glass-cell fallback):

| reason | rule |
|---|---|
| `short` | fewer than 4 studs (`MIN_RUN`) |
| `skew` | less than 75 % of the run lies on a footprint edge that is axis-aligned (drifts < 0.25 m across its length) and sits within half a cell outward of the run's cell centres |
| `thin` | the two rows behind the wall are not the same building |
| `low` | less than one ground floor (18 plates) between floor line and eave |
| `street` | ground/water/deck in front higher than floor line + 2 plates, or water in front |

`skew` is what removes staircases: a building turned 30° rasterises into steps of 1-3
cells, and even a turned building with longer steps has no axis-aligned polygon edge
under them, so every step falls back. A footprint edge within ~1.4° of an axis (0.25 m
over 10 m) still counts as straight. Since contract v3 a building turned more than 3° is not
on the world grid at all: it becomes an **island** (below), where its walls *are* axis-aligned,
so on islands `skew` and `short` staircases no longer happen.

### Planning a run

- **Floor line** (`base`): the highest first-building-cell of the run's columns. Lower
  columns (sloping streets) get plinth down to their own ground.
- **Eave**: the lowest wall top (below the roof band: slope stack + back-row underlay, as
  `tile.py` fills it) over the run and the two rows behind it. Storeys come from the
  building height this way: ground floor 18 plates, each upper storey 15, the remainder
  (`eave_extra`) stays plain wall under the cornice. Roofs stay the LoD2.2 slope
  voxelisation; gable walls above the eave are repainted plain (no glass slits) with one
  `window_1x2x2` attic window where the gable is tall enough.
- **Ground floor** (`streets.py`): a probe strip 8 m deep in front of the middle 80 % of the
  run is tested against the street surfaces (OSM roads buffered by width, minus
  path/track/steps/cycleway/service; road areas). `SHOP` when it touches a pedestrian street
  or square in the centre zones, or the building has a shop/café POI inside (and has an
  upper storey for the sign band); else `HOUSE` with a door (or `ARCHED` for some
  pre-1800 buildings); runs facing no street, or narrower than 8 studs, are `PLAIN`.
- **Style** (`facade_style.py`, hash of the BAG id): trim, accent, plinth, quoins,
  shutters, flower boxes, awning colours, following the eras of `colours.py`: before 1900
  cream/white trim, mergel_dark plinth, shutters and flowers sometimes, quoins on mergel;
  1900-1945 painted trim, no shutters; after 1945 grey trim, no ornament. Light walls get
  a darker trim.

### Painting into chunk tiles (CONTRACT 4 and 7)

The carving: the wall row becomes the trim layer (air between the corner pilasters from
plinth to eave), the row behind it is the wall plane, the next the backdrop row, exactly
the rows a test-scene house has. Then `paint_run` runs through a `FramePainter` onto a
`TileCanvas` (global coordinates, clipped to the tile).

- **Same everywhere**: runs are planned once for the world, and each tile paints every run
  whose box reaches its tile (rim included) in the same order. Neighbouring tiles therefore
  agree on their shared rim (tested), so hollow culling at chunk borders is right.
- **Pieces stay in their chunk**: a tile records only the pieces inside its own chunk.
  Along a run, `FacadeRun.bays()` moves a bay off a chunk border by up to 2 studs (it needs
  `x-1 .. x+3` free for shutters and an arch) or drops it; the shop front skips units on a
  border and picks the door unit nearest the middle with room for its arch. Across the
  wall's depth, a piece that would still straddle a border (a sill whose wall row is the
  last row of a chunk) becomes a voxel stand-in: glass for windows, the piece colour
  otherwise.
- **No overlap**: every piece's cells are cleared first and locked; later fills skip locked
  cells, and a piece landing on a locked cell is skipped.

### Rotated buildings: islands (CONTRACT 5.1, `pipeline/src/blox_pipeline/islands/`)

A wall at 20° on the world grid is a staircase, and a staircase can't carry a window. So a
building whose main wall is more than **3°** off the grid is built on **its own grid, turned
to that wall**, and stored as an island (`.bxi`, [guide 03](03-chunk-format.md)) instead of
in the chunks. The facade grammar itself did not change at all; the trick is where it runs:

1. **Orientation** (`orient.py`): the dominant wall direction of the footprint, modulo 90°
   (a wall and the wall at right angles to it say the same thing). A length-weighted
   histogram of edge angles finds the peak, then a circular mean of the edges near the
   peak refines it, so a chamfered corner or a skewed bay window doesn't drag the answer.
   Island yaw = minus that angle, in (−45°, 45°]. |yaw| ≤ 3° stays on the world grid
   (10 m of wall drifts at most half a metre).
2. **Terraces** (`group.py`): touching island candidates (≥ 2 m of outline within 0.5 m of
   each other: a party wall, not a corner touch) whose yaws differ by ≤ 3° form one group
   with one length-weighted yaw. Merging goes strongest contact first and stops before a
   group's yaws spread over 3°, so a curving street doesn't chain into one giant island.
3. **Local frame** (`frame.py`): footprints, roof planes (polygon, normal, origin) and landmark
   accents are turned by −yaw into local metres, written as "fake RD" `(X0 + u, Y0 + v)` so
   the existing voxeliser, run planner and layout work on it unchanged. Footprints grow by
   half a stud (so turned edges overlap neighbours instead of leaving slits), and the
   origin is snapped so the longest wall along each local axis lies on a cell centre line:
   the grown outline then lies exactly between cell centres. Ground heights are the world
   DTM sampled at each local cell's world position.
4. **Voxelise** (`build.py`): `plan_facades` → `build_layers` → `voxelise_tile` per 64 × 64
   local sub-tile → `strip_ground` (terrain out; each building column extended 2 plates below
   the local ground: the plinth hides the seam on slopes) → `layout_tile`. The walls are
   straight now, so a terrace front is one 12-15 stud run with the full grammar.
5. **Shop fronts are decided in the world**: `WorldStreets` turns each facade probe strip
   back into world RD and asks the world's street context, so a terrace facing a turned
   pedestrian street gets shop fronts exactly as an axis-aligned one would.
6. **On the world grid** the island's footprint is paved (`pavement` tile, priority above
   roads) and marked occupied in `Layers.island_k`: neighbours put no facade or glass
   windows on a party wall against an island, and no tree grows inside it.

`blox build --no-islands` keeps the v2 behaviour (staircases with glass cells).

### What the fixture shows (`tests/town_fixture.py`)

Four terraced gabled houses (both ridge directions, one crossing a chunk border along i,
the back walls on the first row of the next chunk in j), a house turned 30°, a residential
street, a pedestrian street and a café POI. Behind them a terrace of three touching houses
turned −20° with a pedestrian street along its front, and a house turned only 2° (stays on
the grid). The axis-aligned terrace: 10 runs, 170 studs, all fully detailed.

| | runs detailed | exterior wall detailed |
|---|---|---|
| `--no-islands` (v2) | 12 / 182 | **42 %** of 506 studs (264 `short`, 32 `skew`) |
| islands (v3) | 24 / 26 | **93 %** of 454 studs (32 `skew`: the 2° house's two 8 m walls) |
| … of which islands | 12 / 12 | 100 % of 212 studs; the turned terrace's fronts are shops |
`blox build` on it, viewed in the viewer: `build/shots/fixture_hero.png` (close-ups
`fixture_south.png`, `fixture_west.png`, `fixture_north.png`).

```bash
cd pipeline
uv run python tests/town_fixture.py ../build/fixture_data
uv run blox build --data-dir ../build/fixture_data --bbox 176215,317495,176305,317550 \
    --out ../build/fixture_world --no-ortho        # logs the detailed share
cd ../viewer && node build.mjs ../build/fixture_world && node screenshot.mjs ../build/shots hero
```

### Limitations

- **Maastricht's streets are not on the grid**: handled by islands (above) since v3. Real-data
  detail share with islands is not measured yet (data hosts are blocked in the build
  container; v2 measured 4 % on the laptop). An estimate from `samples/markt`: 108 of 132
  whole buildings (82 %) are turned more than 3° (`python -m blox_pipeline.tools.island_share`).
- Buildings turned 1-3° stay on the grid: their long walls may still be `skew` (the fixture's
  2° house's 8 m walls drift 0.28 m). Lowering the threshold is a one-line change (`VoxelConfig.island_min_yaw_deg`).
- Where two detailed walls meet at a corner, a corner window can sit right behind the other
  wall's corner window (two pieces back to back). Rare on the world grid, common on islands
  (free-standing houses have four detailed walls). Visible only from very close.
- Party-wall stretches above a lower neighbour are not runs (glass rhythm).
- Run ends are corner pilasters even where a run ends at a concave corner or a party wall.
- One style per building, one ground-floor kind per run. Since look v2, old-centre runs get
  iron balconies, and runs facing a street get white dormers and a chimney where the roof
  falls toward the street; otherwise roofs stay the LoD2.2 voxelisation.
- Planning builds small layers per building: about 2 ms per building on synthetic data.

## Look v2: the old centre from the photos

Code: `voxelise/colours.py`, `facade_style.py` (`_centre_style`), `facade/{run,windows,ground}.py`,
`facade_runs.roof_details` + `facade_paint.dormer`, `trees.py`, `street_props.py`,
`prepare_osm.py` (kerbs), `layers.py` (sett tones), `facade/stadhuis.py` + `heroes.py`.

**Old centre** = within 700 m of the Markt or the Vrijthof, or built before 1900
(`colours.old_centre`, decided in world RD before a building becomes an island):

| | old centre (before 1945) | elsewhere |
|---|---|---|
| walls | limestone, white/cream/grey plaster; 1 in 12 dark red brick, mergel_light; no ochre | by era, as v2 |
| roofs | slate 5 in 6 | by era |
| dressings | limestone (limestone_dark on limestone walls): pilasters, bands, sills, lintels, cornice, plinth, flush jambs | trim colour |
| windows | `window_1x2x4` white, pier 2; pediments on 1 in 5; french windows with `railing_1x2` on 1 in 3 | `window_1x2x3` |
| ground | stone shop fronts (`shop_window_1x2x4` between proud piers, door + glass transom, fascia with lettering, no awning), white panelled doors (3 in 4), cellar `vent_1x2` | v2 fronts |
| first floor | iron `balcony_2x4` in the middle bay on 2 in 5 street fronts >= 10 studs | none |
| roof | white dormers + chimney on street fronts whose roof falls toward the street | none |

`FacadeRun` fields: `stone`, `door`, `window`, `shop_window`, `surrounds`, `pediments`,
`iron_balcony`, `french`, `vents`, `iron`, `pier`; all default to the v2 grammar, so the v2
look-test houses are unchanged. `HouseSpec` passes them through and adds `dormer` (cheek colour).

Rhythm with the tall window: sill `f..f+2`, window `f+2..f+14`, the next storey band is its
lintel; under the eave cornice it needs `eave_extra >= 1` (else `window_1x2x3`). A pedimented
first-floor window is `window_1x2x3` (`f+3..f+12`) under `pediment_1x4` (`f+12..f+14`);
neighbouring pediments never overlap (a bay is skipped). The iron balcony: french window
`f..f+12`, a stone slab and corbels one row out, `balcony_2x4` (2 deep: trim layer + slab row).

**Dormers on real roofs** (`roof_details`): per window bay (>= 6 studs apart, off chunk cuts),
the first row whose roof in front lies above the eave + 2 is the dormer front; the 4-wide,
3-deep box needs the building's own roof sloping toward the street under it and must stay
under the ridge. `RunPlan.reach` grows the run's paint box so every tile paints it.

**Streets**: centre roads and squares are `cobble_dark` in four tones (dark_grey,
limestone_dark, rail_brown speckle by cell hash); car roads (residential and up) get a 0.6 m
`limestone_dark` kerb ring painted under the other car roads, over footways and squares.
**Props** (`street_props.py`, planned once per world, painted per tile like runs): lamps every
22 m along squares (2 m inside) and pedestrian streets (alternate sides), benches between the
square lamps, bollard-chain-bollard groups every 18 m outside centre car streets. Dropped
within 1.2 m of buildings/islands/heroes/water/decks/trunks, on car roads (lamps, benches), on
uneven ground or across chunk borders. `VoxelConfig.street_props=False` switches them off.

**Trees**: plane/chestnut (`trees.py`): one-stud trunk, bare for >= 4 m (45 % of the height),
three branch stubs, crown of a core plus 3-5 blobs (seeded), noisy outline, paler leaves 1 in
16. Default height 8-15 m (no DSM), crown 0.36 h in 2.5-5.5 m.

### The Stadhuis (hero model)

`Landmark.model = "stadhuis"`: the matched 3D BAG building (BAG id, OSM `wikidata`, name, or
the Markt point; only within 150 m of it) is not voxelised; `heroes.plan_hero` takes the
footprint's cell rectangle (>= 44 x 36 studs, else the BAG shape stays), turns the model so its
front faces the side with most street/square (`StreetContext.area`), and puts the ground line
on the highest ground under it. `layers` marks the rectangle as occupied (like an island). The
model is painted per tile through a `TileCanvas` (a piece across a chunk border becomes voxels,
`stadhuis.place_or`). A footprint turned > 3° makes it an island; the local world plans and
paints it the same way (the island pads 14 cells for the perron).

What `paint_stadhuis` builds (model frame: x along the front, y inward, front faces S):
banded limestone shell with quoins and giant pilasters, a podium with cellar vents, two tall
storeys of `window_1x2x4` + `window_1x2x2` top lights on all four sides, cornices; the risalit
with three `arch_1x6` on piers (balustrades in the arches, keystones), the loggia (door with
fanlight, windows), a full-width balustraded balcony on consoles, the first floor with window
pediments, an attic storey, a pediment with a carved relief (`mergel`) and corner cartouches;
the perron with the double stair and stepped parapets; side pediments; iron railings with
gilt tips and gate piers; a hipped slate roof with lead hips; the tower (`TOWER` stages): square
base with a dormer, oculi row, tall arched windows, clock stage (gold dials, round windows),
gallery with balustrade and flags, open belfry with bells, bell-shaped dome, lantern, gilded
orb and vane. About 15,000 bricks, 330 of them placed pieces (Markt fixture).

### Fixtures and shots

```bash
cd pipeline
uv run python -m blox_pipeline.testscene                       # 2 chunks: v2 look test + photo row
uv run python tests/markt_fixture.py ../build/markt_data       # add 12 to turn the Stadhuis (island)
uv run blox build --data-dir ../build/markt_data --bbox 176340,317890,176540,318090 \
    --out ../build/markt_world --no-ortho
cd ../viewer && node build.mjs ../build/markt_world && node screenshot.mjs ../build/shots hero quality=high
```

Before/after shots: `build/shots/look_v2/` (`before_*` from the pre-look-v2 commit).

## The detail pieces (ids 38-56)

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
| 48 | `window_1x2x4` | 2×1×12 | old-centre windows, Stadhuis | 2×3 panes per sash, small-pane top lights |
| 49 | `shop_window_1x2x4` | 2×1×12 | stone shop fronts | lettering in the upper lights |
| 50 | `balcony_2x4` | 4×2×5 | iron balconies (2 deep: trim layer + slab row) | black, ornate rings and scrolls |
| 51 | `railing_1x2` | 2×1×4 | french-window railings | plain bars |
| 52 | `pediment_1x4` | 4×1×2 | over first-floor windows, Stadhuis | stone colour |
| 53 | `lamp_double_1x3` | 3×1×22 | street lamps (props) | two lanterns, arm along `w` |
| 54 | `bollard_1x1` | 1×1×5 | bollards (props) | chain eyes along `w` |
| 55 | `chain_1x4` | 4×1×3 | between two bollards, 2 plates up | links overhang the box |
| 56 | `vent_1x2` | 2×1×2 | cellar vents in the plinth | |

Ids 48-56 reuse existing kinds (CONTRACT 2.1); the viewer picks their geometry by name
(`details-look.js`) and has cheap far templates for the thin ones (`farmesh.js: lookFar`).
Unity draws them as the generic shape of their kind for now.

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
