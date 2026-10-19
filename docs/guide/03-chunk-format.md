# 03: Chunk format (`.bxc`) and island format (`.bxi`)

Spec: CONTRACT 4. One file per non-empty 64 × 64-stud column chunk:
`chunks/c_{cx:02d}_{cy:02d}.bxc`. Everything is little-endian.

```
offset size  field
0x00   4     magic        "BXC1"
0x04   2     version      1          (the chunk binary is still v1 under contract v2)
0x06   2     flags        bit0 = body is raw DEFLATE (RFC 1951, no zlib header)
0x08   4     cx           int32
0x0C   4     cy           int32
0x10   4     brickCount   uint32
0x14   2     minK         lowest k of any brick
0x16   2     maxK         highest k + h (exclusive top)
0x18   4     bodyBytes    length of the (compressed) body
0x1C   4     reserved     0
0x20   ...   body         brickCount x 12-byte records (after inflating)

record (12 bytes)
+0  u8   i          local 0..63
+1  u8   j          local 0..63
+2  u16  k          global level
+4  u8   typeId     brick_catalogue id
+5  u8   colorIdx   palette idx
+6  u8   rotFlags   bits0-1 rot · bit2 no_variation · bit3 hide_studs · bits4-7 zero
+7  u8   reserved   0
+8  u32  featureId  0 = none, else id in features.json
```

Rules: records sorted by `(k, j, i)`. A brick belongs to the chunk holding its record
position and never crosses a chunk border. No overlaps. Only "hollow" bricks are stored
(at least one exposed face). Colour variation isn't stored: renderers hash `(I, J, K)`.

## Walkthrough: `build/testscene/chunks/c_22_47.bxc`

Made by `uv run python -m blox_pipeline.testscene` (2026-10-19 build). The file is 13,408 bytes.
First 48 bytes (`od -A x -t x1z -N 48`):

```
000000 42 58 43 31 01 00 01 00 16 00 00 00 2f 00 00 00  >BXC1......../...<
000010 95 10 00 00 51 00 de 00 40 34 00 00 00 00 00 00  >....Q...@4......<
000020 4d 9d fb 6b 64 59 92 98 6f ea 91 95 92 32 f5 7e  >M..kdY..o....2.~<
```

| Bytes | Field | Raw | Value |
|---|---|---|---|
| 00-03 | magic | `42 58 43 31` | `"BXC1"` |
| 04-05 | version | `01 00` | 1 |
| 06-07 | flags | `01 00` | DEFLATE body |
| 08-0B | cx | `16 00 00 00` | 22 |
| 0C-0F | cy | `2f 00 00 00` | 47 |
| 10-13 | brickCount | `95 10 00 00` | 4245 |
| 14-15 | minK | `51 00` | 81 (46.2 m NAP: the river bed) |
| 16-17 | maxK | `de 00` | 222 (74.4 m NAP: the highest brick top, on the tower spire) |
| 18-1B | bodyBytes | `40 34 00 00` | 13,376 (= 13,408 − 32) |
| 1C-1F | reserved | `00 00 00 00` | 0 |
| 20- | body | `4d 9d fb ...` | raw DEFLATE stream |

The body inflates to 50,940 bytes = 4245 × 12. In Python: `zlib.decompress(body, -15)`
(negative wbits = raw DEFLATE). The first records:

```
00 00 51 00 06 1f 00 00 00 00 00 00
01 00 51 00 06 1f 01 00 00 00 00 00
```

| i | j | k | typeId | colorIdx | rotFlags | featureId | Meaning |
|---|---|---|---|---|---|---|---|
| 0 | 0 | 81 | 6 `brick_1x8` | 31 `soil` | 0 (rot 0) | 0 | 1 × 8 brick lying along +j, cells j 0..7 |
| 1 | 0 | 81 | 6 `brick_1x8` | 31 `soil` | 1 (rot 1) | 0 | the same brick turned: 8 × 1 along +i, cells i 1..8 |

These two bricks show the running bond at work on the bottom level (`layout/pack2d.py`).

A placed window further in the file:

```
10 2f 8e 00 28 08 02 00 0b 00 00 00
```

i = 16, j = 47, k = 142; type 40 `window_1x2x2`; colour 8 `white` (the frame); rotFlags 2 = rot 2
= **facing S** (towards the street); feature 11. It is a dormer window on the second
townhouse's roof (`facade/roofs.py: _dormer` places it at `wall_j + 1`). Global cell
`I = 22·64 + 16 = 1424`, `J = 47·64 + 47 = 3055`.

And one with `hide_studs`:

```
14 1e 5a 00 01 0b 08 00 00 00 00 00
```

i = 20, j = 30, k = 90; `brick_1x1`, `black`; rotFlags `0x08` = rot 0 + **hide_studs**. This is the
bottom of a café parasol pole. The pole cell above it is boxed in by the table top on all
sides, so it was hollow-culled, and nobody can see this brick's stud.

## Implementations

| Language | Read | Write |
|---|---|---|
| Python | `pipeline/src/blox_pipeline/io/chunk_reader.py` | `io/chunk_writer.py` (`write_world`; layout in `io/format.py`) |
| C# | `unity/Assets/Blox/Runtime/Data/Chunks/ChunkReader.cs` (validates header, sizes, reserved bits, order, border crossing) | `Chunks/ChunkWriter.cs` (tests) |
| JS | `viewer/src/bxc.js` (`DecompressionStream('deflate-raw')`) | none |

Cross-checks:
- **Golden files:** `pipeline/tests/fixtures/golden/` is written by `io/make_golden.py`
  (chunk: `c_01_02*.bxc` + `golden.json`; island: `i_000001*.bxi` + `golden_island.json`).
  Python checks it regenerates byte for byte, and C# (`dotnet/Blox.Tests/ChunkIoTests.cs`)
  reads it and re-encodes the body byte for byte.
- **The test scene in C#:** `dotnet test dotnet/Blox.sln --filter TestsceneChunksLoadAndMesh`
  (folder from `BLOX_WORLD_DIR`, default `build/testscene`).
- **Viewer:** `viewer/test/bxc.test.mjs`.

## Islands: `islands/i_{id:06d}.bxi` (contract v3)

Spec: CONTRACT 5.1. A building (or terrace) turned more than 3° off the world grid is built
on its own grid, turned to its main wall, and stored as an island instead of in the chunks
(why and how: [guide 04](04-facades-and-pieces.md#rotated-buildings-islands-contract-51-pipelinesrcblox_pipelineislands)).
The body is the same 12-byte record as a chunk, but `i, j` are **local island cells**
(0..255, an island is at most 256 × 256 studs) and `k` is global. The 40-byte header holds
the pose instead of chunk bounds:

```
offset size  field
0x00   4     magic        "BXI1"
0x04   2     version      1
0x06   2     flags        bit0 = body is raw DEFLATE
0x08   4     islandId     uint32 (manifest "islands"[].id)
0x0C   4     cx           int32  owning chunk: the chunk holding the island's centre (streaming/LOD)
0x10   4     cy           int32
0x14   4     originX      float32 Unity metres: world position of local cell (0, 0)'s min corner
0x18   4     originZ      float32
0x1C   4     yawDeg       float32 clockwise from north, (-45, 45]
0x20   4     brickCount   uint32
0x24   4     bodyBytes    uint32
0x28   ...   body         brickCount x 12-byte records (section 4 layout)
```

**Placing a local point.** `(u, v)` metres (u along local +i, v along +j) land at
`x = originX + u·cos(yaw) + v·sin(yaw)`, `z = originZ − u·sin(yaw) + v·cos(yaw)`, and
`y = k · 0.2`. So local +j points along the yaw (yaw 0: north) like a brick model's forward.
Python: `islands/pose.py: island_local_to_world`, checked against
`contract/test_vectors/islands.json` like every other language. Facing (N/E/S/W) inside an
island means the **local** axes; renderers move the whole island as one rigid object.

Walkthrough of the golden `pipeline/tests/fixtures/golden/i_000001_uncompressed.bxi`:

```
000000 42 58 49 31 01 00 00 00 01 00 00 00 13 00 00 00  >BXI1............<
000010 2c 00 00 00 00 10 19 44 00 18 a8 44 00 00 06 c2  >,......D...D....<
000020 07 00 00 00 54 00 00 00 00 00 78 00 09 01 00 00  >....T.....x.....<
```

| Bytes | Field | Raw | Value |
|---|---|---|---|
| 00-03 | magic | `42 58 49 31` | `"BXI1"` |
| 04-05 | version | `01 00` | 1 |
| 06-07 | flags | `00 00` | not compressed (`i_000001.bxi` has `01 00`) |
| 08-0B | islandId | `01 00 00 00` | 1 |
| 0C-13 | cx, cy | `13 ..`, `2c ..` | chunk (19, 44) |
| 14-17 | originX | `00 10 19 44` | 612.25 |
| 18-1B | originZ | `00 18 a8 44` | 1344.75 |
| 1C-1F | yawDeg | `00 00 06 c2` | −33.5 |
| 20-23 | brickCount | `07 00 00 00` | 7 |
| 24-27 | bodyBytes | `54 00 00 00` | 84 = 7 × 12 |
| 28- | first record | `00 00 78 00 09 01 00 00 07 00 00 00` | local (0, 0), k 120, `brick_2x4`, colour 1, rot 0, feature 7: world min corner (612.25, 24.0, 1344.75) |

`golden_island.json` lists every field of every record plus its world position.

| Language | Read | Write |
|---|---|---|
| Python | `pipeline/src/blox_pipeline/io/island_reader.py` (`read_island`, `read_world_islands`) | `io/island_writer.py` (`write_world(..., islands=...)`; layout in `io/island_format.py`) |

Rules the writer checks: every brick inside 256 × 256, `k + h ≤ 65535`, |yaw| ≤ 45 with
−45 excluded, known flags. Records are sorted `(k, j, i)` as in chunks. Bricks also never
cross a 64-stud line inside an island (the pipeline lays islands out in 64 × 64 sub-tiles,
reusing the chunk code); that is a pipeline property, not a format rule.

## The manifest

`manifest.json` (CONTRACT 5) lists each chunk with `bricks`, `minK`, `maxK` and the file's
`sha1`, so a loader can plan LOD from the bounds before opening any chunk. Since v3 it also
has `"islands": [{"id", "file", "cx", "cy", "bricks", "sha1"}]` (always present, maybe
empty). `contractVersion` is 3 (the Python reader still accepts 1 and 2: same chunk bytes,
no islands). `WorldFiles.Open(dir, verifySha1: true)` in C# checks the hashes.
