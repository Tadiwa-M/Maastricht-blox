#nullable enable
using UnityEngine.Rendering;

namespace Blox.Meshing
{
    /// <summary>
    /// Unity vertex layout of <see cref="Core.BrickVertex"/> (64 bytes, one stream), shared by
    /// chunk meshes and brick-model meshes so both work with the BrickBody / BrickTransparent
    /// shaders. Order and formats must match the struct field order exactly.
    /// </summary>
    public static class BrickVertexLayout
    {
        public static readonly VertexAttributeDescriptor[] Attributes =
        {
            new VertexAttributeDescriptor(VertexAttribute.Position, VertexAttributeFormat.Float32, 3),
            new VertexAttributeDescriptor(VertexAttribute.Normal, VertexAttributeFormat.Float32, 3),
            new VertexAttributeDescriptor(VertexAttribute.Color, VertexAttributeFormat.Float32, 4),
            new VertexAttributeDescriptor(VertexAttribute.TexCoord0, VertexAttributeFormat.Float32, 2),
            new VertexAttributeDescriptor(VertexAttribute.TexCoord1, VertexAttributeFormat.Float32, 2),
            new VertexAttributeDescriptor(VertexAttribute.TexCoord2, VertexAttributeFormat.Float32, 2),
        };
    }
}
