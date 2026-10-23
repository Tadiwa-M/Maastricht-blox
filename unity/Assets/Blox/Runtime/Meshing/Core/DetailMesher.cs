#nullable enable
using System;
using Blox.Data;

namespace Blox.Meshing.Core
{
    /// <summary>
    /// Geometry of the v2 detail pieces (CONTRACT section 2.1): arch, window, door, fence and
    /// grille tile. Each piece is drawn in its own rot-0 metre frame (front at z = d, see
    /// <see cref="DetailShapes"/>) from boxes, quads and round posts (<see cref="DetailParts"/>);
    /// <see cref="BrickXform"/> then turns it to the record's facing. Window and door panes always
    /// use the glass material (submesh 1), whatever the record colour, and carry the brick's seed
    /// so the shader can light each window differently at night.
    /// (Round tiles go through <see cref="RoundMesher"/>; jumpers are plain plates.)
    /// </summary>
    public static class DetailMesher
    {
        public static void Emit<TSink>(ref TSink sink, in PlacedBrick br, in BrickTypeInfo t, in BrickXform xf, in MeshContext ctx, in FaceStyle style)
            where TSink : struct, IChunkMeshSink
        {
            var c = new DetailContext
            {
                Brick = br, Type = t, Xf = xf, Mesh = ctx, Body = style,
                Glass = new FaceStyle { R = ctx.Glass.R, G = ctx.Glass.G, B = ctx.Glass.B, Material = MaterialClass.Glass, Seed01 = style.Seed01 },
            };
            switch (t.Kind)
            {
                case BrickKind.Arch: Arch(ref sink, c); break;
                case BrickKind.Window: Window(ref sink, c); break;
                case BrickKind.Door: Door(ref sink, c); break;
                case BrickKind.Fence: Fence(ref sink, c); break;
                case BrickKind.TileGrille: Grille(ref sink, c); break;
            }
        }

        // ---- arch -----------------------------------------------------------------------

        private static void Arch<TSink>(ref TSink sink, in DetailContext c) where TSink : struct, IChunkMeshSink
        {
            DetailShapes.SizeM(c.Type, out float w, out float h, out float d);
            DetailShapes.ArchOpening(c.Type, out float cx, out float rx, out float side, out _, out _);
            float xl = cx - rx, xr = cx + rx;
            int n = DetailShapes.ArchSegments(c.Type);

            // Solid outside: the two ends and the top are plain box faces.
            DetailParts.Box(ref sink, c, c.Body, 0, w, 0, h, 0, d,
                DetailParts.Skip(Dir.PosZ) | DetailParts.Skip(Dir.NegZ) | DetailParts.Skip(Dir.NegY));
            // Bottom: only under the two piers.
            DetailParts.Box(ref sink, c, c.Body, 0, xl, 0, h, 0, d, ~DetailParts.Skip(Dir.NegY));
            DetailParts.Box(ref sink, c, c.Body, xr, w, 0, h, 0, d, ~DetailParts.Skip(Dir.NegY));
            // Inner sides of the piers, facing into the opening.
            DetailParts.Box(ref sink, c, c.Body, xl - 1, xl, 0, side, 0, d, ~DetailParts.Skip(Dir.PosX));
            DetailParts.Box(ref sink, c, c.Body, xr, xr + 1, 0, side, 0, d, ~DetailParts.Skip(Dir.NegX));

            // Front (z = d) and back (z = 0): two piers plus one vertical strip per curve segment,
            // all bevelled against the whole face rectangle so only the real outline gets edges.
            for (int face = 0; face < 2; face++)
            {
                int dir = face == 0 ? Dir.PosZ : Dir.NegZ;
                float z = face == 0 ? d : 0f;
                var normal = DetailParts.Normal(dir);
                var frame = Rect(0, w, 0, h, z);
                var p = new Poly();
                p.Add(0, 0, z); p.Add(xl, 0, z); p.Add(xl, side, z); p.Add(xl, h, z); p.Add(0, h, z);
                DetailParts.EmitFramed(ref sink, c, p, normal, c.Body, frame);
                p = new Poly();
                // Start at the springing point so the triangle fan never spans three collinear points.
                p.Add(xr, side, z); p.Add(xr, 0, z); p.Add(w, 0, z); p.Add(w, h, z); p.Add(xr, h, z);
                DetailParts.EmitFramed(ref sink, c, p, normal, c.Body, frame);
                for (int s = 0; s < n; s++)
                {
                    ArchPoint(c.Type, s, n, out float ax, out float ay);
                    ArchPoint(c.Type, s + 1, n, out float bx, out float by);
                    p = new Poly();
                    p.Add(ax, ay, z); p.Add(bx, by, z); p.Add(bx, h, z); p.Add(ax, h, z);
                    DetailParts.EmitFramed(ref sink, c, p, normal, c.Body, frame);
                }
            }

            // The curved underside, one quad per segment, facing into the opening (no seams).
            for (int s = 0; s < n; s++)
            {
                ArchPoint(c.Type, s, n, out float ax, out float ay);
                ArchPoint(c.Type, s + 1, n, out float bx, out float by);
                var p = new Poly();
                p.Add(ax, ay, 0); p.Add(bx, by, 0); p.Add(bx, by, d); p.Add(ax, ay, d);
                var inward = new Float3(cx - (ax + bx) * 0.5f, side - (ay + by) * 0.5f - 1e-3f, 0);
                DetailParts.Emit(ref sink, c, p, inward, c.Body, false);
            }
        }

        /// <summary>Point s of n on the arch curve, from the left springing (s = 0) over the crown to the right.</summary>
        public static void ArchPoint(in BrickTypeInfo t, int s, int n, out float x, out float y)
        {
            DetailShapes.ArchOpening(t, out float cx, out float rx, out float side, out float ry, out _);
            double a = Math.PI - Math.PI * s / n;
            x = cx + rx * (float)Math.Cos(a);
            y = side + ry * (float)Math.Sin(a);
            if (s == 0) x = cx - rx;           // exact springing points (no trig round-off)
            if (s == n) x = cx + rx;
            if (s == 0 || s == n) y = side;
        }

        // ---- window and door ------------------------------------------------------------

        private static void Window<TSink>(ref TSink sink, in DetailContext c) where TSink : struct, IChunkMeshSink
        {
            DetailShapes.SizeM(c.Type, out float w, out float h, out float d);
            const float bar = DetailShapes.BarM, g = DetailShapes.GlazingHalfM;
            int sides = DetailParts.Skip(Dir.NegX) | DetailParts.Skip(Dir.PosX);
            Frame(ref sink, c, w, h, d, withSill: true);

            float zp = d - DetailShapes.PaneBackM, zf = zp + DetailShapes.PaneThicknessM * 0.5f, zb = zf + DetailShapes.GlazingDepthM;
            Pane(ref sink, c, bar, w - bar, bar, h - bar, zp);
            // Glazing bars just in front of the pane: a vertical mullion and a transom at 2/3 height.
            float yt = DetailShapes.TransomY(h), mid = w * 0.5f;
            DetailParts.Box(ref sink, c, c.Body, mid - g, mid + g, bar, h - bar, zf, zb, DetailParts.Skip(Dir.NegY) | DetailParts.Skip(Dir.PosY));
            DetailParts.Box(ref sink, c, c.Body, bar, mid - g, yt - g, yt + g, zf, zb, sides);
            DetailParts.Box(ref sink, c, c.Body, mid + g, w - bar, yt - g, yt + g, zf, zb, sides);
        }

        private static void Door<TSink>(ref TSink sink, in DetailContext c) where TSink : struct, IChunkMeshSink
        {
            DetailShapes.SizeM(c.Type, out float w, out float h, out float d);
            const float bar = DetailShapes.BarM;
            int sides = DetailParts.Skip(Dir.NegX) | DetailParts.Skip(Dir.PosX);
            Frame(ref sink, c, w, h, d, withSill: false);

            // Fanlight: a full-depth bar under it, glass in the top 2 plates, one glazing bar.
            float yf = DetailShapes.FanlightY(h);
            DetailParts.Box(ref sink, c, c.Body, bar, w - bar, yf, yf + bar, 0, d, sides);
            float zp = d - DetailShapes.PaneBackM, zf = zp + DetailShapes.PaneThicknessM * 0.5f;
            Pane(ref sink, c, bar, w - bar, yf + bar, h - bar, zp);
            float mid = w * 0.5f;
            DetailParts.Box(ref sink, c, c.Body, mid - 0.015f, mid + 0.015f, yf + bar, h - bar, zf, zf + DetailShapes.GlazingDepthM,
                DetailParts.Skip(Dir.NegY) | DetailParts.Skip(Dir.PosY));

            // Leaf, set back from the frame front, with 4 raised panels and a handle.
            float lz = d - DetailShapes.LeafBackM;
            DetailParts.Box(ref sink, c, c.Body, bar, w - bar, 0, yf, lz - DetailShapes.LeafThicknessM, lz, sides | DetailParts.Skip(Dir.PosY));
            const float m = 0.06f, gap = 0.06f;
            float lx0 = bar, leafW = w - 2 * bar, pw = (leafW - 2 * m - gap) * 0.5f;
            float avail = yf - 2 * m - gap, split = m + avail * 0.42f;
            for (int row = 0; row < 2; row++)
            {
                float y0 = row == 0 ? m : split + gap, y1 = row == 0 ? split : yf - m;
                for (int col = 0; col < 2; col++)
                {
                    float x0 = lx0 + m + col * (pw + gap);
                    DetailParts.Box(ref sink, c, c.Body, x0, x0 + pw, y0, y1, lz, lz + 0.018f, DetailParts.Skip(Dir.NegZ));
                }
            }
            float hx = w - bar - 0.1f;
            DetailParts.Box(ref sink, c, c.Body, hx, hx + 0.03f, yf * 0.48f, yf * 0.52f, lz, lz + 0.04f, DetailParts.Skip(Dir.NegZ));
        }

        /// <summary>Full-depth frame: two side bars, a top bar and optionally a sill.</summary>
        private static void Frame<TSink>(ref TSink sink, in DetailContext c, float w, float h, float d, bool withSill)
            where TSink : struct, IChunkMeshSink
        {
            const float bar = DetailShapes.BarM;
            int sides = DetailParts.Skip(Dir.NegX) | DetailParts.Skip(Dir.PosX);
            DetailParts.Box(ref sink, c, c.Body, 0, bar, 0, h, 0, d);
            DetailParts.Box(ref sink, c, c.Body, w - bar, w, 0, h, 0, d);
            DetailParts.Box(ref sink, c, c.Body, bar, w - bar, h - bar, h, 0, d, sides);
            if (withSill) DetailParts.Box(ref sink, c, c.Body, bar, w - bar, 0, bar, 0, d, sides);
        }

        /// <summary>A glass pane centred on depth <paramref name="zp"/>: front and back only (its edges are inside the frame).</summary>
        private static void Pane<TSink>(ref TSink sink, in DetailContext c, float x0, float x1, float y0, float y1, float zp)
            where TSink : struct, IChunkMeshSink
        {
            float t = DetailShapes.PaneThicknessM * 0.5f;
            int edgesOff = DetailParts.Skip(Dir.NegX) | DetailParts.Skip(Dir.PosX) | DetailParts.Skip(Dir.NegY) | DetailParts.Skip(Dir.PosY);
            DetailParts.Box(ref sink, c, c.Glass, x0, x1, y0, y1, zp - t, zp + t, edgesOff, edges: false);
        }

        // ---- fence and grille -----------------------------------------------------------

        private static void Fence<TSink>(ref TSink sink, in DetailContext c) where TSink : struct, IChunkMeshSink
        {
            DetailShapes.SizeM(c.Type, out float w, out float h, out float d);
            const float rail = DetailShapes.RailM;
            DetailParts.Box(ref sink, c, c.Body, 0, w, h - rail, h, 0, d);
            DetailParts.Box(ref sink, c, c.Body, 0, w, 0, rail, 0, d);
            for (float x = DetailShapes.SpindleStepM * 0.5f; x < w; x += DetailShapes.SpindleStepM)
                DetailParts.Post(ref sink, c, c.Body, x, d * 0.5f, DetailShapes.SpindleRadiusM, rail, h - rail, DetailShapes.SpindleSegments, caps: false);
        }

        private static void Grille<TSink>(ref TSink sink, in DetailContext c) where TSink : struct, IChunkMeshSink
        {
            DetailShapes.SizeM(c.Type, out float w, out float h, out float d);
            const float g = DetailShapes.GrooveM;
            int ribs = DetailShapes.GrilleGrooves + 1;
            float rib = (d - DetailShapes.GrilleGrooves * g) / ribs, yb = h - g;
            // Base slab (its top shows only in the grooves), then the ribs standing on it.
            DetailParts.Box(ref sink, c, c.Body, 0, w, 0, yb, 0, d, DetailParts.Skip(Dir.PosY));
            for (int r = 0; r < ribs; r++)
            {
                float z0 = r * (rib + g), z1 = r == ribs - 1 ? d : z0 + rib;
                DetailParts.Box(ref sink, c, c.Body, 0, w, yb, h, z0, z1, DetailParts.Skip(Dir.NegY));
                if (r < ribs - 1) DetailParts.Box(ref sink, c, c.Body, 0, w, yb - 1, yb, z1, z1 + g, ~DetailParts.Skip(Dir.PosY));
            }
        }

        private static Poly Rect(float x0, float x1, float y0, float y1, float z)
        {
            var p = new Poly();
            p.Add(x0, y0, z); p.Add(x1, y0, z); p.Add(x1, y1, z); p.Add(x0, y1, z);
            return p;
        }
    }
}
