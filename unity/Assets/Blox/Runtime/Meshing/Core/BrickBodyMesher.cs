#nullable enable
using System;
using Blox.Data;

namespace Blox.Meshing.Core
{
    /// <summary>Context shared by every brick of a chunk build.</summary>
    public ref struct MeshContext
    {
        public ReadOnlySpan<ushort> Cells;
        public CellGridDims Dims;
        public ReadOnlySpan<BrickTypeInfo> Types;
        public ReadOnlySpan<PaletteColor> Colors;
        public float OriginX, OriginZ;
    }

    /// <summary>
    /// Emits the body faces of one brick: one polygon per face (bottom, flat top, sloped
    /// surfaces, front/back, two side profiles), skipping axis-aligned faces that are fully
    /// hidden by neighbouring bricks (<see cref="CellGrid.FaceHidden"/>). Sloped faces are always emitted.
    /// </summary>
    public static class BrickBodyMesher
    {
        public static void Emit<TSink>(ref TSink sink, in PlacedBrick br, in BrickTypeInfo t, in MeshContext ctx, in FaceStyle style)
            where TSink : struct, IChunkMeshSink
        {
            var xf = new BrickXform { I = br.I, J = br.J, K = br.K, W = t.W, D = t.D, Rot = br.Rot, OriginX = ctx.OriginX, OriginZ = ctx.OriginZ };
            if (t.Kind == BrickKind.Round) { RoundMesher.Emit(ref sink, xf, t, ctx, style); return; }

            float w = t.W, d = t.D, h = t.H;
            Poly p;

            if (FaceVisible(br, t, Dir.NegY, ctx, style.Material))
            {
                p = default; p.Add(0, 0, 0); p.Add(w, 0, 0); p.Add(w, 0, d); p.Add(0, 0, d);
                FaceEmitter.EmitLocal(ref sink, xf, p, new Float3(0, -1, 0), style);
            }

            // Flat top over the rows whose profile stays at full height.
            int b0 = -1, b1 = -1;
            for (int b = 0; b < t.D; b++)
                if (BrickProfile.MinOverRow(t, b) >= t.H) { if (b0 < 0) b0 = b; b1 = b + 1; }
            if (b0 >= 0 && FaceVisible(br, t, Dir.PosY, ctx, style.Material))
            {
                p = default; p.Add(0, h, b0); p.Add(w, h, b0); p.Add(w, h, b1); p.Add(0, h, b1);
                FaceEmitter.EmitLocal(ref sink, xf, p, new Float3(0, 1, 0), style);
            }

            // Sloped segments of the profile.
            int nb = BrickProfile.Breakpoints(t, out float z0, out float z1, out float z2);
            for (int s = 0; s + 1 < nb; s++)
            {
                float za = s == 0 ? z0 : z1, zb = s == 0 ? z1 : z2;
                if (zb <= za) continue;
                float ha = BrickProfile.Height(t, za), hb = BrickProfile.Height(t, zb);
                if (Math.Abs(ha - hb) < 1e-6f) continue;
                p = default; p.Add(0, ha, za); p.Add(w, ha, za); p.Add(w, hb, zb); p.Add(0, hb, zb);
                FaceEmitter.EmitLocal(ref sink, xf, p, new Float3(0, 1, 0), style);
            }

            float y0 = BrickProfile.Height(t, 0), yd = BrickProfile.Height(t, t.D);
            if (FaceVisible(br, t, Dir.NegZ, ctx, style.Material))
            {
                p = default; p.Add(0, 0, 0); p.Add(w, 0, 0); p.Add(w, y0, 0); p.Add(0, y0, 0);
                FaceEmitter.EmitLocal(ref sink, xf, p, new Float3(0, 0, -1), style);
            }
            if (FaceVisible(br, t, Dir.PosZ, ctx, style.Material))
            {
                p = default; p.Add(0, 0, d); p.Add(w, 0, d); p.Add(w, yd, d); p.Add(0, yd, d);
                FaceEmitter.EmitLocal(ref sink, xf, p, new Float3(0, 0, 1), style);
            }

            for (int side = 0; side < 2; side++)
            {
                int dir = side == 0 ? Dir.NegX : Dir.PosX;
                if (!FaceVisible(br, t, dir, ctx, style.Material)) continue;
                float x = side == 0 ? 0 : w;
                p = default;
                p.Add(x, 0, 0);
                p.Add(x, 0, d);
                p.Add(x, yd, d);
                if (nb == 3 && z1 > 0 && z1 < d) p.Add(x, BrickProfile.Height(t, z1), z1);
                p.Add(x, y0, 0);
                FaceEmitter.EmitLocal(ref sink, xf, p, new Float3(side == 0 ? -1 : 1, 0, 0), style);
            }
        }

        /// <summary>
        /// True when at least one boundary cell the brick's face on local side <paramref name="localDir"/>
        /// touches is not hidden by its neighbour.
        /// </summary>
        public static bool FaceVisible(in PlacedBrick br, in BrickTypeInfo t, int localDir, in MeshContext ctx, MaterialClass self)
        {
            int rot = br.Rot;
            int worldDir = Dir.LocalToWorld(localDir, rot);
            int aLo = 0, aHi = t.W - 1, bLo = 0, bHi = t.D - 1, pLo = 0, pHi = t.H - 1;
            switch (localDir)
            {
                case Dir.PosX: aLo = aHi; break;
                case Dir.NegX: aHi = aLo; break;
                case Dir.PosZ: bLo = bHi; break;
                case Dir.NegZ: bHi = bLo; break;
                case Dir.PosY: pLo = pHi; break;
                default: pHi = pLo; break;
            }
            for (int p = pLo; p <= pHi; p++)
                for (int b = bLo; b <= bHi; b++)
                    for (int a = aLo; a <= aHi; a++)
                    {
                        if (!BrickProfile.TouchesLocal(t, localDir, a, b, p)) continue;
                        Footprint.RotateCell(a, b, t.W, t.D, rot, out int ci, out int cj);
                        if (!CellGrid.FaceHidden(ctx.Cells, ctx.Dims, br.I + ci, br.J + cj, br.K + p, worldDir, self)) return true;
                    }
            return false;
        }
    }
}
