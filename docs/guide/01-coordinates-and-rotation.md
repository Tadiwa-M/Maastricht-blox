# 01: Coordinates and rotation

Spec: CONTRACT sections 1, 2 and 7.1. The shared test vectors are in
`contract/test_vectors/rotation.json`.

## Three spaces

| Space | Axes | Unit | Used by |
|---|---|---|---|
| **RD** (EPSG:28992) | x east, y north, z = metres NAP | metres | source data, pipeline input, proxy input |
| **Grid** | `I` east, `J` north, `K` up (integers) | cells: 0.5 m × 0.5 m × 0.2 m | voxels, brick records, chunk files |
| **Unity world** | x east, y up, z north (left-handed) | metres | Unity, live proxy output, poses |
| **three.js** (viewer only) | x east, y up, **−z north** (right-handed) | metres | browser viewer |

Constants: slice origin RD `(175700, 316500)`, base level 30.0 m NAP, stud 0.5 m, plate 0.2 m,
chunk 64 studs.

```
RD → grid:      I = floor((x - 175700) / 0.5)    J = floor((y - 316500) / 0.5)    K = floor((z - 30.0) / 0.2)
grid → Unity:   unity.x = I * 0.5                unity.z = J * 0.5                unity.y = K * 0.2      (cell min corner)
grid → three:   three.x = I * 0.5                three.z = -J * 0.5               three.y = K * 0.2
chunk:          cx = I // 64, i = I % 64         cy = J // 64, j = J % 64
```

### Worked example: Vrijthof

RD `(176185, 317717)` at a ground level of 48.0 m NAP:

| Step | Calculation | Result |
|---|---|---|
| grid I | (176185 − 175700) / 0.5 | **970** |
| grid J | (317717 − 316500) / 0.5 | **2434** |
| grid K | (48.0 − 30.0) / 0.2 | **90** |
| chunk | 970 // 64, 2434 // 64 | **(15, 38)** → `chunks/c_15_38.bxc` |
| local cell | 970 % 64, 2434 % 64 | **i = 10, j = 2** |
| Unity | (970·0.5, 90·0.2, 2434·0.5) | **(485.0, 18.0, 1217.0)** |
| three.js | (485.0, 18.0, −1217.0) | |

These numbers were computed with the pipeline's own helpers
(`geo.rd_to_grid`, `geo.rd_to_unity`, `geo.chunk_of`, `geo.z_to_k`).

Where the conversion lives:

| Language | File |
|---|---|
| Python pipeline | `pipeline/src/blox_pipeline/geo.py` (`rd_to_grid`, `z_to_k`, `grid_to_unity`, `rd_to_unity`, `chunk_of`) |
| Python proxy | `proxy/src/blox_proxy/geo.py` (WGS84 → RD → world metres) |
| C# | `unity/Assets/Blox/Runtime/Data/Contract/WorldSpec.cs` (`RdToCell`, `RdToUnity`, `CellToUnityX/Y/Z`, `ChunkOf`) |
| JS | `viewer/src/placement.js` (`gridToThree`, `unityToThree`) |

## Rotation: the facing rule

A brick type is described **unrotated**: `w` studs along +i, `d` studs along +j, `h` plates.
A record stores `rot ∈ {0,1,2,3}`, meaning the piece is turned `rot × 90°` **clockwise seen
from above**. The record position `(i, j, k)` is the **min corner of the rotated bounding box**.

**The one rule:** every directional piece (window, door, arch, fence, slope, model) has a
*front*, and at rot 0 the front faces **+j (north)**. Code says which way the front should
face, and a helper picks the rot:

| facing | front faces | rot | typical use |
|---|---|---|---|
| `N` | +j | 0 | round details (no front), models at yaw 0 |
| `E` | +i | 1 | bus doors (the bus's right side) |
| `S` | −j | 2 | **house street fronts** in the facade grammar |
| `W` | −i | 3 | windows on a west side wall |

A slope's front is its **low edge**.

### A 2 × 1 piece at each facing (top-down, north up)

Unrotated cells: `A` = (a=0, b=0), `B` = (a=1, b=0). `^ > v <` show where the front faces.
`o` marks the record position (the min corner).

```
 N  (rot 0)        E  (rot 1)        S  (rot 2)        W  (rot 3)
    ^ ^             +---+             +---+---+          +---+
  +---+---+         | A | >           | B | A |        < | B |
  | A | B |         +---+             +---+---+          +---+
  o---+---+         | B | >           o   v   v        < | A |
                    o---+                                o---+
 extent 2x1        extent 1x2        extent 2x1        extent 1x2
 A at (0,0)        A at (0,1)        A at (1,0)        A at (0,0)
 B at (1,0)        B at (0,0)        B at (0,0)        B at (0,1)
```

Turning clockwise sends north to east: at E, `A` (which was west) is now on the north end.

### `footprint_cell`: where cell (a, b) lands

`a` runs along `w` (0..w−1), `b` along `d` (0..d−1). The result is an offset `(di, dj)` from the
record position, always ≥ 0:

| rot | (di, dj) | extent (along i, j) |
|---|---|---|
| 0 | (a, b) | w × d |
| 1 | (b, w−1−a) | d × w |
| 2 | (w−1−a, d−1−b) | w × d |
| 3 | (d−1−b, a) | d × w |

Why the flips: a clockwise turn sends +j → +i and +i → −j. A negative direction is then shifted
back so that the min corner stays at the record position, hence `w−1−a` / `d−1−b`.

### Where the helpers live

Every language has exactly one rotation module. Nothing else does rot arithmetic.

| Language | File | Names |
|---|---|---|
| Python | `pipeline/src/blox_pipeline/rotation.py` | `Facing`, `facing_to_rot`, `rot_to_facing`, `front_dir`, `rotated_extent`, `footprint_cell`, `footprint_cells` |
| JS | `viewer/src/rotation.js` | `FACING`, `facingToRot`, `frontDir`, `rotatedExtent`, `footprintCell`, `rotToYaw` |
| C# | `unity/Assets/Blox/Runtime/Data/Geometry/Rotation.cs` | `Facing`, `FacingToRot`, `FacingToYawDeg`, `YawToFacing`, `FrontDir`, `RotatedExtent`, `FootprintCell`, `RotatePoint`, `RotateDir` |

Placing things by facing, in each language:

```python
cv.place("window_1x2x3", i, j, k, "S", "white", fid)          # pipeline Canvas / Painter
make_placed(cat, "door_1x2x4", I=10, J=40, K=95, facing="S", color=7)
```
```js
const rot = facingToRot('E');                                 // viewer
```
```csharp
BrickRecord.Place(i, j, k, typeId, colorIdx, Facing.E);      // Unity
```

### How renderers turn geometry

- **Viewer:** geometry is modelled centred on the unrotated footprint with the front toward
  −z (= +j). `brickMatrix` (`viewer/src/placement.js`) rotates by `rotToYaw(rot) = −rot·90°`
  about +y (clockwise from above is negative in right-handed three.js), then moves the
  centre to `(I + ei/2, K, J + ej/2)`.
- **Unity mesher:** geometry is built in the rot-0 frame with the front at z = d.
  `BrickXform.Point` (`Meshing/Core/FaceEmitter.cs`) calls `Rotation.RotatePoint`, which maps
  `(x, z)` to `(x, z) / (z, w−x) / (w−x, d−z) / (d−z, x)` for rot 0..3.
- **Poses:** yaw is degrees clockwise from north. In Unity that is `Quaternion.Euler(0, yaw, 0)`.
  In three.js it is `rotation.y = −yaw` (`poseToObject` in `viewer/src/mover.js`).

## Shared test vectors

`contract/test_vectors/rotation.json` holds the facing → rot table, `front_dir` per rot, and for
many `(w, d, rot)` cases the extent and every `[a, b, di, dj]` cell. All three languages load it:

| Language | Test |
|---|---|
| Python | `pipeline/tests/test_rotation.py` |
| JS | `viewer/test/rotation.test.mjs` |
| C# | `dotnet/Blox.Tests/RotationTests.cs` |

If you ever touch a rotation module, these three tests are the safety net. On 2026-10-19 all
cases passed in all three languages.
