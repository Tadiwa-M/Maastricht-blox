using System.Collections.Generic;
using System.Runtime.InteropServices;
using Blox.Data;
using Blox.Meshing.Core;
using UnityEngine;
using UnityEngine.Rendering;

namespace Blox.Rendering
{
    /// <summary>
    /// Draws exposed studs with Graphics.RenderMeshIndirect. Every full-detail chunk uploads
    /// its stud list once into its own GraphicsBuffer. Each frame, chunks inside the stud range
    /// and the camera frustum are culled per stud on the GPU (StudCull.compute), which appends
    /// visible studs to a near list (16-segment bevelled stud) or a mid list (8 segments), and
    /// counts them into one indirect-args buffer per LOD; two indirect draws render them all.
    /// Beyond <see cref="MidDistance"/> no studs are drawn: Blox/BrickBody fakes them.
    /// <para>Islands (CONTRACT 5.1) are uploaded as their own batches (<see cref="SetIsland"/>).
    /// Their stud positions are baked into world space on the CPU (and the island yaw added to
    /// each stud's spin) when the mesh completes, so the cull shader and the stud shader need no
    /// per-batch matrix and treat island studs exactly like chunk studs.</para>
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class StudRenderer : MonoBehaviour
    {
        private static readonly int SourceId = Shader.PropertyToID("_Source");
        private static readonly int SourceCountId = Shader.PropertyToID("_SourceCount");
        private static readonly int VisibleNearId = Shader.PropertyToID("_VisibleNear");
        private static readonly int VisibleMidId = Shader.PropertyToID("_VisibleMid");
        private static readonly int NearCapacityId = Shader.PropertyToID("_NearCapacity");
        private static readonly int MidCapacityId = Shader.PropertyToID("_MidCapacity");
        private static readonly int ArgsNearId = Shader.PropertyToID("_ArgsNear");
        private static readonly int ArgsMidId = Shader.PropertyToID("_ArgsMid");
        private static readonly int FrustumPlanesId = Shader.PropertyToID("_FrustumPlanes");
        private static readonly int CameraPositionId = Shader.PropertyToID("_CameraPosition");
        private static readonly int NearDistanceId = Shader.PropertyToID("_NearDistance");
        private static readonly int MidDistanceId = Shader.PropertyToID("_MidDistance");
        private static readonly int StudRadiusId = Shader.PropertyToID("_StudRadius");
        private static readonly int InstancesId = Shader.PropertyToID("_StudInstances");

        private static readonly int StudStride = Marshal.SizeOf<StudInstance>();

        [Tooltip("Material using the Blox/Stud shader.")]
        [SerializeField] private Material material;
        [Tooltip("StudCull.compute")]
        [SerializeField] private ComputeShader cullShader;
        [Tooltip("Camera whose frustum and position drive the culling (default: Camera.main).")]
        [SerializeField] private Camera cullingCamera;
        [Tooltip("Studs closer than this use the 16-segment bevelled mesh (m).")]
        [SerializeField, Min(1f)] private float nearDistance = 45f;
        [Tooltip("Studs closer than this use the 8-segment mesh; beyond, the brick shader fakes them (m).")]
        [SerializeField, Min(2f)] private float midDistance = 130f;
        [Tooltip("Fake studs in Blox/BrickBody start fading in at this fraction of the mid distance.")]
        [SerializeField, Range(0.3f, 1f)] private float fakeFadeStart = 0.8f;
        [Tooltip("Maximum near-LOD studs drawn per frame.")]
        [SerializeField, Min(1024)] private int nearCapacity = 400_000;
        [Tooltip("Maximum mid-LOD studs drawn per frame.")]
        [SerializeField, Min(1024)] private int midCapacity = 1_200_000;
        [SerializeField] private bool nearCastsShadows = true;
        [SerializeField] private bool midCastsShadows = false;

        private sealed class ChunkStuds
        {
            public GraphicsBuffer Buffer;
            public int Count;
            public Bounds Bounds;
        }

        // One batch per full-detail chunk or island; see ChunkKey / IslandKey.
        private readonly Dictionary<long, ChunkStuds> _chunks = new Dictionary<long, ChunkStuds>();
        private readonly Plane[] _planes = new Plane[6];
        private readonly Vector4[] _planeVectors = new Vector4[6];
        private readonly GraphicsBuffer.IndirectDrawIndexedArgs[] _args = new GraphicsBuffer.IndirectDrawIndexedArgs[1];
        private Mesh _nearMesh, _midMesh;
        private GraphicsBuffer _visibleNear, _visibleMid, _argsNear, _argsMid;
        private MaterialPropertyBlock _propsNear, _propsMid;
        private int _kernel;
        private bool _ready;

        public float NearDistance => nearDistance;
        public float MidDistance => midDistance;
        public int ChunkCount => _chunks.Count;
        public int TotalStuds { get; private set; }

        private void OnEnable()
        {
            if (!SystemInfo.supportsComputeShaders)
            {
                Debug.LogWarning("StudRenderer: compute shaders / indirect draws are not supported; studs are faked by the brick shader only.");
                return;
            }
            if (material == null || cullShader == null)
            {
                Debug.LogError("StudRenderer: assign the Blox/Stud material and StudCull.compute (Blox/Create Look Test Scene does this).");
                return;
            }
            _kernel = cullShader.FindKernel("Cull");
            _nearMesh = StudMeshes.CreateNear();
            _midMesh = StudMeshes.CreateMid();
            _visibleNear = new GraphicsBuffer(GraphicsBuffer.Target.Structured, nearCapacity, StudStride) { name = "Blox Studs Near" };
            _visibleMid = new GraphicsBuffer(GraphicsBuffer.Target.Structured, midCapacity, StudStride) { name = "Blox Studs Mid" };
            // One IndirectDrawIndexedArgs command each; Raw so the compute shader can InterlockedAdd
            // into instanceCount (byte offset 4) through a RWByteAddressBuffer.
            const GraphicsBuffer.Target argsTarget = GraphicsBuffer.Target.IndirectArguments | GraphicsBuffer.Target.Raw;
            _argsNear = new GraphicsBuffer(argsTarget, 1, GraphicsBuffer.IndirectDrawIndexedArgs.size) { name = "Blox Studs Near Args" };
            _argsMid = new GraphicsBuffer(argsTarget, 1, GraphicsBuffer.IndirectDrawIndexedArgs.size) { name = "Blox Studs Mid Args" };
            _propsNear = new MaterialPropertyBlock();
            _propsNear.SetBuffer(InstancesId, _visibleNear);
            _propsMid = new MaterialPropertyBlock();
            _propsMid.SetBuffer(InstancesId, _visibleMid);
            _ready = true;
            PublishFade();
        }

        private void OnDisable()
        {
            _ready = false;
            foreach (var c in _chunks.Values) c.Buffer.Release();
            _chunks.Clear();
            TotalStuds = 0;
            _visibleNear?.Release();
            _visibleMid?.Release();
            _argsNear?.Release();
            _argsMid?.Release();
            if (_nearMesh != null) Destroy(_nearMesh);
            if (_midMesh != null) Destroy(_midMesh);
        }

        private void OnValidate()
        {
            midDistance = Mathf.Max(midDistance, nearDistance + 1f);
            if (_ready) PublishFade();
        }

        private void PublishFade() => BloxShaderGlobals.SetFakeStudFade(midDistance * fakeFadeStart, midDistance);

        private static long ChunkKey(ChunkCoord c) => ((long)(uint)c.X << 32) | (uint)c.Y;
        private static long IslandKey(uint id) => (1L << 62) | id;

        /// <summary>Replaces a chunk's studs (absolute world positions, from the chunk mesher).</summary>
        public void SetChunk(ChunkCoord coord, StudInstance[] studs) => SetBatch(ChunkKey(coord), coord.ToString(), studs);

        public void RemoveChunk(ChunkCoord coord) => RemoveBatch(ChunkKey(coord));

        /// <summary>Replaces an island's studs (already in world space: PendingChunkMesh applies the pose).</summary>
        public void SetIsland(uint islandId, StudInstance[] studs) => SetBatch(IslandKey(islandId), $"island {islandId}", studs);

        public void RemoveIsland(uint islandId) => RemoveBatch(IslandKey(islandId));

        private void SetBatch(long key, string label, StudInstance[] studs)
        {
            RemoveBatch(key);
            if (!_ready || studs.Length == 0) return;
            var buffer = new GraphicsBuffer(GraphicsBuffer.Target.Structured, studs.Length, StudStride) { name = $"Blox Studs {label}" };
            buffer.SetData(studs);
            var min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            foreach (var s in studs)
            {
                var p = new Vector3(s.X, s.Y, s.Z);
                min = Vector3.Min(min, p);
                max = Vector3.Max(max, p);
            }
            var bounds = new Bounds();
            bounds.SetMinMax(min - new Vector3(0.2f, 0f, 0.2f), max + new Vector3(0.2f, 0.15f, 0.2f));
            _chunks[key] = new ChunkStuds { Buffer = buffer, Count = studs.Length, Bounds = bounds };
            TotalStuds += studs.Length;
        }

        private void RemoveBatch(long key)
        {
            if (!_chunks.TryGetValue(key, out var c)) return;
            c.Buffer.Release();
            TotalStuds -= c.Count;
            _chunks.Remove(key);
        }

        private void LateUpdate()
        {
            if (!_ready || _chunks.Count == 0) return;
            var cam = cullingCamera != null ? cullingCamera : Camera.main;
            if (cam == null) return;

            GeometryUtility.CalculateFrustumPlanes(cam, _planes);
            for (int n = 0; n < 6; n++) _planeVectors[n] = new Vector4(_planes[n].normal.x, _planes[n].normal.y, _planes[n].normal.z, _planes[n].distance);
            ResetArgs(_argsNear, _nearMesh);
            ResetArgs(_argsMid, _midMesh);

            Vector3 camPos = cam.transform.position;
            cullShader.SetVectorArray(FrustumPlanesId, _planeVectors);
            cullShader.SetVector(CameraPositionId, camPos);
            cullShader.SetFloat(NearDistanceId, nearDistance);
            cullShader.SetFloat(MidDistanceId, midDistance);
            cullShader.SetFloat(StudRadiusId, 0.2f);
            cullShader.SetInt(NearCapacityId, nearCapacity);
            cullShader.SetInt(MidCapacityId, midCapacity);
            cullShader.SetBuffer(_kernel, VisibleNearId, _visibleNear);
            cullShader.SetBuffer(_kernel, VisibleMidId, _visibleMid);
            cullShader.SetBuffer(_kernel, ArgsNearId, _argsNear);
            cullShader.SetBuffer(_kernel, ArgsMidId, _argsMid);

            float midSqr = midDistance * midDistance;
            foreach (var c in _chunks.Values)
            {
                if (c.Bounds.SqrDistance(camPos) >= midSqr) continue;
                if (!GeometryUtility.TestPlanesAABB(_planes, c.Bounds)) continue;
                cullShader.SetBuffer(_kernel, SourceId, c.Buffer);
                cullShader.SetInt(SourceCountId, c.Count);
                cullShader.Dispatch(_kernel, (c.Count + 63) / 64, 1, 1);
            }

            var bounds = new Bounds(new Vector3(1024f, 100f, 1024f), new Vector3(2400f, 600f, 2400f));
            var near = new RenderParams(material)
            {
                worldBounds = bounds,
                matProps = _propsNear,
                shadowCastingMode = nearCastsShadows ? ShadowCastingMode.On : ShadowCastingMode.Off,
                receiveShadows = true,
                layer = gameObject.layer,
            };
            var mid = near;
            mid.matProps = _propsMid;
            mid.shadowCastingMode = midCastsShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
            Graphics.RenderMeshIndirect(near, _nearMesh, _argsNear);
            Graphics.RenderMeshIndirect(mid, _midMesh, _argsMid);
        }

        private void ResetArgs(GraphicsBuffer args, Mesh mesh)
        {
            _args[0] = new GraphicsBuffer.IndirectDrawIndexedArgs
            {
                indexCountPerInstance = mesh.GetIndexCount(0),
                instanceCount = 0, // filled by the cull shader
                startIndex = mesh.GetIndexStart(0),
                baseVertexIndex = mesh.GetBaseVertex(0),
                startInstance = 0,
            };
            args.SetData(_args);
        }
    }
}
