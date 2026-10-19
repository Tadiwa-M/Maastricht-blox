using Blox.Data;
using Blox.Meshing;
using UnityEngine;
using UnityEngine.Rendering;

namespace Blox.Rendering
{
    /// <summary>
    /// One chunk's MeshFilter + MeshRenderer. Kept GPU-Resident-Drawer friendly: plain
    /// MeshRenderer, shared materials (submesh 0 = Blox/BrickBody, 1 = Blox/BrickTransparent),
    /// no MaterialPropertyBlocks, no light probes. The mesh is reused when the chunk switches
    /// between full detail and HLOD boxes. Islands (CONTRACT 5.1) use the same component on a
    /// GameObject placed and rotated by the island pose; <see cref="Coord"/> is then the owning chunk.
    /// </summary>
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    [DisallowMultipleComponent]
    public sealed class ChunkRenderer : MonoBehaviour
    {
        private Mesh _mesh;
        private MeshRenderer _renderer;

        public ChunkCoord Coord { get; private set; }
        /// <summary>Current level (0 = full detail, 1..3 = HLOD factor 2/4/8, -1 = nothing yet).</summary>
        public int Level { get; private set; } = -1;
        public int VertexCount { get; private set; }

        /// <param name="meshName">Defaults to "Blox c_XX_YY"; islands pass "Blox island N".</param>
        public void Init(ChunkCoord coord, Material opaque, Material transparent, string meshName = null)
        {
            Coord = coord;
            _mesh = new Mesh { name = meshName ?? $"Blox {coord}" };
            GetComponent<MeshFilter>().sharedMesh = _mesh;
            _renderer = GetComponent<MeshRenderer>();
            _renderer.sharedMaterials = new[] { opaque, transparent };
            _renderer.shadowCastingMode = ShadowCastingMode.On;
            _renderer.receiveShadows = true;
            _renderer.lightProbeUsage = LightProbeUsage.Off;
            _renderer.reflectionProbeUsage = ReflectionProbeUsage.BlendProbes;
            _renderer.motionVectorGenerationMode = MotionVectorGenerationMode.Camera;
            _renderer.allowOcclusionWhenDynamic = true;
            _renderer.enabled = false;
        }

        /// <summary>Completes a mesh job into this chunk's mesh.</summary>
        public ChunkMeshResult Apply(PendingChunkMesh pending, int level)
        {
            var result = pending.Complete(_mesh);
            Level = level;
            VertexCount = result.VertexCount;
            _renderer.enabled = result.VertexCount > 0;
            return result;
        }

        private void OnDestroy()
        {
            if (_mesh != null) Destroy(_mesh);
        }
    }
}
