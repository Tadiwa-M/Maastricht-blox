#nullable enable
using System;
using Blox.Data;

namespace Blox.Meshing.Core
{
    /// <summary>
    /// Which studs of a brick are visible. A brick has "stud spots": one per stud cell
    /// (<see cref="Footprint.HasStud"/>), or a single spot on the footprint centre for jumper
    /// plates (<c>studs: center</c>). A spot is exposed when the cell(s) right above it are empty;
    /// any brick there, glass included, hides it. Records with the v2 <c>hide_studs</c> flag
    /// (their tops are buried under culled building interiors) have no exposed studs at all.
    /// Chunks turn exposed spots into <see cref="StudInstance"/>s (drawn instanced); models
    /// turn them into stud geometry (<see cref="StudMesher"/>).
    /// </summary>
    public static class StudExtractor
    {
        /// <summary>How many spots to visit for a type (exposed or not).</summary>
        public static int SpotCount(in BrickTypeInfo t) => Footprint.HasCenterStud(t) ? 1 : t.W * t.D;

        /// <summary>
        /// Spot <paramref name="n"/> of the brick: true when it carries a stud that is exposed.
        /// <paramref name="ci"/>/<paramref name="cj"/> are the stud centre in (fractional) global
        /// cells; <paramref name="seedI"/>/<paramref name="seedJ"/> the cell whose hash rotates it.
        /// </summary>
        public static bool ExposedSpot(in PlacedBrick br, in BrickTypeInfo t, int n, ReadOnlySpan<ushort> cells, in CellGridDims dims,
                                       out float ci, out float cj, out int seedI, out int seedJ)
        {
            ci = cj = 0; seedI = seedJ = 0;
            if (br.HideStuds || t.Studs == StudPattern.None) return false;
            int rot = br.Rot, top = br.K + t.H;
            if (Footprint.HasCenterStud(t))
            {
                Rotation.RotatedExtent(t, rot, out int ei, out int ej);
                for (int dj = 0; dj < ej; dj++)
                    for (int di = 0; di < ei; di++)
                        if (CellGrid.Occupied(CellGrid.Get(cells, dims, br.I + di, br.J + dj, top))) return false;
                ci = br.I + ei * 0.5f; cj = br.J + ej * 0.5f;
                seedI = br.I; seedJ = br.J;
                return true;
            }
            int a = n % t.W, b = n / t.W;
            if (!Footprint.HasStud(t, a, b)) return false;
            Rotation.FootprintCell(a, b, t.W, t.D, rot, out int oi, out int oj);
            seedI = br.I + oi; seedJ = br.J + oj;
            if (CellGrid.Occupied(CellGrid.Get(cells, dims, seedI, seedJ, top))) return false;
            ci = seedI + 0.5f; cj = seedJ + 0.5f;
            return true;
        }

        /// <summary>Adds a <see cref="StudInstance"/> (absolute Unity metres) for every exposed spot.</summary>
        public static void Emit<TSink>(ref TSink sink, in PlacedBrick br, in BrickTypeInfo t, ReadOnlySpan<ushort> cells, in CellGridDims dims, in FaceStyle style)
            where TSink : struct, IChunkMeshSink
        {
            if (br.HideStuds || t.Studs == StudPattern.None) return;
            int top = br.K + t.H, spots = SpotCount(t);
            for (int n = 0; n < spots; n++)
            {
                if (!ExposedSpot(br, t, n, cells, dims, out float ci, out float cj, out int si, out int sj)) continue;
                uint seed = BrickVariation.Seed(si, sj, top);
                sink.AddStud(new StudInstance
                {
                    X = ci * Units.StudM,
                    Y = top * Units.PlateM,
                    Z = cj * Units.StudM,
                    R = style.R, G = style.G, B = style.B,
                    AngleDeg = BrickVariation.StudAngleDeg(seed),
                    Material = (float)style.Material,
                });
            }
        }
    }
}
