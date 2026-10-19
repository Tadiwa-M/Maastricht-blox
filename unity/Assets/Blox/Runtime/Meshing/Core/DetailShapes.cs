#nullable enable
using System;
using Blox.Data;

namespace Blox.Meshing.Core
{
    /// <summary>
    /// Measurements of the v2 detail pieces (CONTRACT section 2.1) and which cell faces they
    /// close off. Everything is in the piece's own rot-0 frame in <b>metres</b>: x along local +i
    /// in [0, w * 0.5], y up in [0, h * 0.2], z along local +j in [0, d * 0.5], and the decorated
    /// front at z = d * 0.5 (it faces +j at rot 0, i.e. the facing the record says).
    /// The numbers match the browser viewer (viewer/src/details.js) so both look the same.
    /// </summary>
    public static class DetailShapes
    {
        /// <summary>Window/door frame bar width (contract: 0.06 m).</summary>
        public const float BarM = 0.06f;
        /// <summary>Glass panes sit this far behind the front face (contract: 0.1 m).</summary>
        public const float PaneBackM = 0.1f;
        public const float PaneThicknessM = 0.012f;
        /// <summary>Mullion/transom (glazing bar) half width and depth, in front of the pane.</summary>
        public const float GlazingHalfM = 0.02f;
        public const float GlazingDepthM = 0.03f;
        /// <summary>Door leaf front is set back from the frame front (contract: 0.06 m); leaf thickness.</summary>
        public const float LeafBackM = 0.06f;
        public const float LeafThicknessM = 0.05f;
        /// <summary>Fence rails are half a plate (0.1 m); spindles every 0.25 m, radius 0.04 m.</summary>
        public const float RailM = 0.1f;
        public const float SpindleStepM = 0.25f;
        public const float SpindleRadiusM = 0.04f;
        public const int SpindleSegments = 6;
        /// <summary>Grille tile: 3 grooves (contract), 0.04 m wide and deep.</summary>
        public const int GrilleGrooves = 3;
        public const float GrooveM = 0.04f;

        /// <summary>Piece size in metres.</summary>
        public static void SizeM(in BrickTypeInfo t, out float w, out float h, out float d)
        {
            w = t.W * Units.StudM; h = t.H * Units.PlateM; d = t.D * Units.StudM;
        }

        /// <summary>
        /// Arch opening: centred, (w - 2) studs wide, open at the bottom. Straight sides up to
        /// <paramref name="side"/>, then a half ellipse (semi-axes rx, ry) up to the crown; a lintel
        /// of max(0.1 m, h / 6) stays solid above it. arch_1x4: side 0.25 m, crown 0.5 m;
        /// arch_1x6: side 0.5 m, crown 1.0 m (5 plates).
        /// </summary>
        public static void ArchOpening(in BrickTypeInfo t, out float cx, out float rx, out float side, out float ry, out float crown)
        {
            SizeM(t, out float w, out float h, out _);
            cx = w * 0.5f;
            rx = Math.Max(1, t.W - 2) * Units.StudM * 0.5f;
            float lintel = Math.Max(0.1f, h / 6f);
            crown = h - lintel;
            ry = Math.Min(rx, crown * 0.5f);
            side = crown - ry;
        }

        /// <summary>Number of segments on the arch's curved top (more for wider arches).</summary>
        public static int ArchSegments(in BrickTypeInfo t) => t.W >= 6 ? 12 : 8;

        /// <summary>Height of the transom (window) above the bottom: 2/3 of the glazed height.</summary>
        public static float TransomY(float h) => BarM + (h - 2f * BarM) * (2f / 3f);

        /// <summary>Bottom of the door's fanlight zone: the top 2 plates are the glazed fanlight.</summary>
        public static float FanlightY(float h) => h - 2f * Units.PlateM;

        /// <summary>
        /// Whether a detail piece fully closes the face on local side <paramref name="dir"/> of its
        /// local cell (a, b, p), so a neighbour's face there can be dropped. Openings (arch hole,
        /// window glass, door recess, fence gaps, grille grooves) never count as closed.
        /// </summary>
        public static bool CoversLocal(in BrickTypeInfo t, int dir, int a, int b, int p)
        {
            switch (t.Kind)
            {
                case BrickKind.Arch:
                {
                    bool inOpening = a >= 1 && a <= t.W - 2;
                    ArchOpening(t, out _, out _, out _, out _, out float crown);
                    switch (dir)
                    {
                        case Dir.NegY: return !inOpening;
                        case Dir.PosZ:
                        case Dir.NegZ: return !inOpening || p * Units.PlateM >= crown - 1e-4f;
                        default: return true; // top and both solid ends
                    }
                }
                case BrickKind.Window:
                    return dir != Dir.PosZ && dir != Dir.NegZ;           // full-depth frame all round
                case BrickKind.Door:
                    return dir == Dir.PosX || dir == Dir.NegX || dir == Dir.PosY;
                case BrickKind.Fence:
                    return dir == Dir.PosY || dir == Dir.NegY;          // rails; gaps between spindles
                case BrickKind.TileGrille:
                    return dir == Dir.NegY || dir == Dir.PosZ || dir == Dir.NegZ;
                default:
                    return false;
            }
        }
    }
}
