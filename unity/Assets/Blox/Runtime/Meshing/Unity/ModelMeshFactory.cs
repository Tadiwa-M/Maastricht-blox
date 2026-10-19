#nullable enable
using Blox.Data;
using Blox.Meshing.Core;
using UnityEngine;
using UnityEngine.Rendering;

namespace Blox.Meshing
{
    /// <summary>
    /// Builds Unity meshes for a <see cref="BrickModel"/>, one per part (CONTRACT 7.1), on the
    /// main thread (models are small and built once). Geometry comes from
    /// <see cref="ModelMesherCore"/>; vertices are relative to the part pivot, so a part
    /// object placed at <see cref="ModelMesherCore.PartOffset"/> rotates about its pivot.
    /// Submesh 0 = opaque, 1 = trans/glass (windows), like chunk meshes.
    /// </summary>
    public static class ModelMeshFactory
    {
        /// <summary>Mesh of part <paramref name="part"/> (-1 = static body), or null when that part has no bricks.</summary>
        public static Mesh? BuildPart(BrickModel model, int part, BrickTypeInfo[] types, PaletteColor[] colors)
        {
            var sink = ListMeshSink.Create();
            ModelMesherCore.BuildPart(ref sink, model, part, types, colors);
            if (sink.VertexCount == 0) return null;
            string name = part < 0 ? $"{model.Name}_body" : $"{model.Name}_{model.Parts[part].Name}";
            var mesh = new Mesh { name = name };
            int vCount = sink.VertexCount, n0 = sink.Indices[0].Count, n1 = sink.Indices[1].Count;
            mesh.SetVertexBufferParams(vCount, BrickVertexLayout.Attributes);
            mesh.SetVertexBufferData(sink.Vertices, 0, 0, vCount);
            mesh.SetIndexBufferParams(n0 + n1, IndexFormat.UInt32);
            if (n0 > 0) mesh.SetIndexBufferData(sink.Indices[0], 0, 0, n0);
            if (n1 > 0) mesh.SetIndexBufferData(sink.Indices[1], 0, n0, n1);
            mesh.subMeshCount = 2;
            mesh.SetSubMesh(0, new SubMeshDescriptor(0, n0));
            mesh.SetSubMesh(1, new SubMeshDescriptor(n0, n1));
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
