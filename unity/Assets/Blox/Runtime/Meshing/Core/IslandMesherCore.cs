#nullable enable
using System;
using Blox.Data;

namespace Blox.Meshing.Core
{
    /// <summary>
    /// Meshes one island (CONTRACT 5.1) with the same core as chunks, in the island's LOCAL space.
    ///
    /// <para><b>Why local space.</b> An island is a building on its own grid, turned by a yaw. On
    /// that grid it is exactly like a chunk: axis-aligned bricks, local (i, j), global k. So the
    /// chunk mesher runs unchanged with the island grid as "the world" (cell (0, 0) at the
    /// origin, no neighbours) and produces one mesh per island. The renderer then places that mesh
    /// as one rigid object at the island's pose (position (originX, 0, originZ), rotation
    /// <c>Quaternion.Euler(0, yawDeg, 0)</c>). Face culling and stud exposure therefore only look
    /// at the island's own bricks, which is what the contract asks: the chunk grid does not cover
    /// island cells (it only holds the paving underneath).</para>
    ///
    /// <para>Output: vertex positions in island-local metres (x = u along +i, z = v along +j,
    /// y = K * 0.2 absolute). Studs are local too; <see cref="StudsToWorld"/> turns them into
    /// absolute Unity positions for the instanced stud renderer.</para>
    ///
    /// <para>Colour variation hashes the island-local (i, j, k) (there is no global cell for a
    /// rotated brick); see docs/guide/07-unity.md.</para>
    /// </summary>
    public static class IslandMesherCore
    {
        /// <summary>Island records -> mesher input in island-local cells.</summary>
        public static PlacedBrick[] ToPlaced(BrickRecord[] records)
        {
            var bricks = new PlacedBrick[records.Length];
            for (int n = 0; n < records.Length; n++) bricks[n] = PlacedBrick.From(records[n], 0, 0);
            return bricks;
        }

        /// <summary>Local extent (in studs) of a set of bricks: max of i + rotated width, j + rotated depth.</summary>
        public static void Extent(ReadOnlySpan<PlacedBrick> bricks, ReadOnlySpan<BrickTypeInfo> types, out int extentI, out int extentJ)
        {
            extentI = extentJ = 0;
            for (int n = 0; n < bricks.Length; n++)
            {
                var t = types[bricks[n].Type];
                if (t.Defined == 0) continue;
                Rotation.RotatedExtent(t, bricks[n].Rot, out int ei, out int ej);
                extentI = Math.Max(extentI, bricks[n].I + ei);
                extentJ = Math.Max(extentJ, bricks[n].J + ej);
            }
        }

        /// <summary>Cell grid over the island's extent plus a one-cell ring (SizeK = 0 when empty).</summary>
        public static CellGridDims ComputeDims(ReadOnlySpan<PlacedBrick> bricks, ReadOnlySpan<BrickTypeInfo> types)
        {
            Extent(bricks, types, out int ei, out int ej);
            return CellGrid.ComputeDims(bricks, types, 0, 0, ei, ej);
        }

        /// <summary>
        /// Fills <paramref name="cells"/> (length <c>dims.Length</c>) and meshes every brick into the sink.
        /// Burst-compatible: no managed allocations.
        /// </summary>
        public static void Build<TSink>(ref TSink sink, ReadOnlySpan<PlacedBrick> bricks, Span<ushort> cells, in CellGridDims dims,
                                        ReadOnlySpan<BrickTypeInfo> types, ReadOnlySpan<PaletteColor> colors)
            where TSink : struct, IChunkMeshSink
        {
            if (dims.SizeK == 0) return;
            CellGrid.Fill(cells, dims, bricks, types, colors);
            // Origin (0, 0): positions come out in island-local metres.
            ChunkMesherCore.Build(ref sink, bricks, cells, dims, types, colors, 0f, 0f);
        }

        /// <summary>Convenience for tools and tests: allocates the cell grid itself.</summary>
        public static void BuildManaged<TSink>(ref TSink sink, BrickRecord[] records, BrickTypeInfo[] types, PaletteColor[] colors)
            where TSink : struct, IChunkMeshSink
        {
            var bricks = ToPlaced(records);
            var dims = ComputeDims(bricks, types);
            if (dims.SizeK == 0) return;
            var cells = new ushort[dims.Length];
            Build(ref sink, bricks, cells, dims, types, colors);
        }

        /// <summary>
        /// Island-local studs -> absolute Unity world metres, in place. Position goes through the
        /// pose; the stud's own spin (<see cref="StudInstance.AngleDeg"/>, applied by the stud shader
        /// exactly like <c>Quaternion.Euler(0, angle, 0)</c>) gets the island yaw added, because two
        /// rotations about +Y compose by adding angles. Height is unchanged (global k).
        /// </summary>
        public static void StudsToWorld(Span<StudInstance> studs, in IslandPose pose)
        {
            float yaw = (float)pose.YawDeg;
            for (int n = 0; n < studs.Length; n++)
            {
                pose.LocalToWorld(studs[n].X, studs[n].Z, out double x, out double z);
                studs[n].X = (float)x;
                studs[n].Z = (float)z;
                studs[n].AngleDeg += yaw;
            }
        }
    }
}
