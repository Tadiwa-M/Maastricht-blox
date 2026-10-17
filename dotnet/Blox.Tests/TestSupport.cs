using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Blox.Data;
using Blox.Meshing.Core;

namespace Blox.Tests
{
    [AttributeUsage(AttributeTargets.Assembly)]
    public sealed class RepoRootAttribute : Attribute
    {
        public string Path { get; }
        public RepoRootAttribute(string path) { Path = path; }
    }

    public static class Repo
    {
        public static string Root { get; } = System.IO.Path.GetFullPath(
            typeof(Repo).Assembly.GetCustomAttribute<RepoRootAttribute>()!.Path);

        public static string PathOf(params string[] parts) => System.IO.Path.Combine(Root, System.IO.Path.Combine(parts));

        public static Catalogue Catalogue { get; } = Catalogue.Parse(File.ReadAllText(PathOf("contract", "brick_catalogue.json")));
        public static Palette Palette { get; } = Palette.Parse(File.ReadAllText(PathOf("contract", "palette.json")));
        public static BrickTypeInfo[] Types { get; } = Catalogue.ToTable();
        public static PaletteColor[] Colors { get; } = Palette.ToTable();

        public static byte TypeId(string name) => Catalogue.ByName(name).Id;
    }

    /// <summary>Test sink collecting mesher output in Lists.</summary>
    public struct ListSink : IChunkMeshSink
    {
        public List<BrickVertex> Vertices;
        public List<int>[] Indices;
        public List<StudInstance> Studs;

        public static ListSink Create() => new ListSink
        {
            Vertices = new List<BrickVertex>(),
            Indices = new[] { new List<int>(), new List<int>() },
            Studs = new List<StudInstance>(),
        };

        public int VertexCount => Vertices.Count;
        public void AddVertex(in BrickVertex v) => Vertices.Add(v);
        public void AddTriangle(int submesh, int a, int b, int c) { Indices[submesh].Add(a); Indices[submesh].Add(b); Indices[submesh].Add(c); }
        public void AddStud(in StudInstance s) => Studs.Add(s);

        public int TriangleCount(int submesh) => Indices[submesh].Count / 3;

        /// <summary>Triangles as (a, b, c) vertex triples across both submeshes.</summary>
        public IEnumerable<(BrickVertex a, BrickVertex b, BrickVertex c, int submesh)> Triangles()
        {
            for (int s = 0; s < 2; s++)
                for (int n = 0; n < Indices[s].Count; n += 3)
                    yield return (Vertices[Indices[s][n]], Vertices[Indices[s][n + 1]], Vertices[Indices[s][n + 2]], s);
        }
    }

    /// <summary>Runs the full mesher on global bricks for chunk (cx, cy) like the Burst job does.</summary>
    public static class MeshRunner
    {
        public static ListSink Run(int cx, int cy, PlacedBrick[] own, PlacedBrick[]? neighbours = null)
        {
            var all = new List<PlacedBrick>(own);
            if (neighbours != null) all.AddRange(neighbours);
            var types = Repo.Types.AsSpan();
            var colors = Repo.Colors.AsSpan();
            int i0 = cx * 64, j0 = cy * 64;
            var dims = CellGrid.ComputeDims(own, types, i0, j0);
            var sink = ListSink.Create();
            if (dims.SizeK == 0) return sink;
            var cells = new ushort[dims.Length];
            CellGrid.Fill(cells, dims, all.ToArray(), types, colors);
            ChunkMesherCore.Build(ref sink, own, cells, dims, types, colors, i0 * Units.StudM, j0 * Units.StudM);
            return sink;
        }

        public static PlacedBrick Brick(string type, int i, int j, int k, int rot = 0, byte color = 4, bool noVariation = false) =>
            new PlacedBrick(i, j, k, Repo.TypeId(type), color, (byte)((rot & 3) | (noVariation ? BrickRecord.FlagNoVariation : 0)));
    }
}
