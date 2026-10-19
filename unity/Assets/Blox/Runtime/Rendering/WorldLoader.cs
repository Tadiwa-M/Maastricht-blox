using System.Collections.Generic;
using System.IO;
using Blox.Data;
using Blox.Meshing;
using Unity.Jobs;
using UnityEngine;

namespace Blox.Rendering
{
    /// <summary>
    /// Streams a pipeline world directory (CONTRACT section 5) into chunk renderers.
    /// Every frame it plans per-chunk HLOD levels from the camera distance, schedules a few
    /// Burst mesh jobs (Blox.Meshing ChunkMeshBuilder), completes finished ones on later
    /// frames and hands the studs of full-detail chunks to the <see cref="StudRenderer"/> and
    /// the fake-stud lookup (<see cref="StudTopsBuffer"/>). Chunk data is loaded on demand
    /// (with its 8 neighbours for full detail, for exact border culling) and unloaded when
    /// no full-detail chunk needs it any more.
    ///
    /// <para><b>Islands (v3, CONTRACT 5.1).</b> Rotated buildings live in .bxi islands, each owned
    /// by the chunk holding its centre. An island simply follows its owner: whenever the owner is
    /// (re)meshed at some level, the owner's islands are meshed at the same level (full detail or
    /// the same HLOD factor), so islands use exactly the chunk distance policy with no planner of
    /// their own. Each island is one GameObject under "Islands" at (originX, 0, originZ) with
    /// rotation Euler(0, yawDeg, 0) (see <see cref="ChunkMeshBuilder.IslandTransform"/>); its studs
    /// go to the <see cref="StudRenderer"/> already in world space. Island faces use copies of the
    /// brick materials with fake studs off: the fake-stud lookup (<see cref="StudTopsBuffer"/>) is
    /// indexed by world-grid columns, which do not line up with a rotated grid.</para>
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class WorldLoader : MonoBehaviour, IWorldSource
    {
        [Tooltip("World output directory. Relative paths are resolved against the Unity project folder (the folder that contains Assets/).")]
        [SerializeField] private string worldDirectory = "../build/testscene";
        [SerializeField] private Material opaqueMaterial;
        [SerializeField] private Material transparentMaterial;
        [SerializeField] private StudRenderer studRenderer;
        [Tooltip("Camera used for LOD distances (default: Camera.main).")]
        [SerializeField] private Camera viewCamera;
        [SerializeField] private ChunkLodPolicy lod = ChunkLodPolicy.Default;
        [Tooltip("Chunks farther than this are not shown at all (m).")]
        [SerializeField, Min(10f)] private float maxDistance = 4000f;
        [SerializeField, Range(1, 32)] private int maxSchedulesPerFrame = 4;
        [SerializeField, Range(1, 64)] private int maxJobsInFlight = 16;
        [Tooltip("Check every chunk file against the manifest sha1 when loading.")]
        [SerializeField] private bool verifySha1;

        // TempJob allocations must be released within 4 frames: force completion after this many.
        private const int MaxJobAgeFrames = 3;

        private struct InFlight
        {
            public PendingChunkMesh Pending;
            public int Level;
            public int Frame;
        }

        private readonly Dictionary<ChunkCoord, ChunkRenderer> _renderers = new Dictionary<ChunkCoord, ChunkRenderer>();
        private readonly Dictionary<uint, ChunkRenderer> _islandRenderers = new Dictionary<uint, ChunkRenderer>();
        // Jobs still running per chunk (its own mesh plus its islands); the chunk is busy until 0.
        private readonly Dictionary<ChunkCoord, int> _jobsPerChunk = new Dictionary<ChunkCoord, int>();
        private readonly List<uint> _islandScratch = new List<uint>();
        private readonly List<InFlight> _inFlight = new List<InFlight>();
        private readonly HashSet<ChunkCoord> _busy = new HashSet<ChunkCoord>();
        private readonly List<ChunkCoord> _scratch = new List<ChunkCoord>();
        private ChunkMeshBuilder _builder;
        private StudTopsBuffer _studTops;
        private ChunkLodPlanner _planner;
        private System.Func<ChunkCoord, int> _levelOf;
        private Transform _root;
        private Transform _islandRoot;
        private Material _islandOpaque, _islandTransparent;
        private static readonly int FakeStudStrengthId = Shader.PropertyToID("_FakeStudStrength");

        public WorldIndex World { get; private set; }
        public string ResolvedDirectory => ResolveDirectory(worldDirectory);
        public int ChunksShown => _renderers.Count;
        public int IslandsShown => _islandRenderers.Count;
        public int JobsInFlight => _inFlight.Count;

        /// <summary>
        /// A player started with <c>-bloxWorld &lt;dir&gt;</c> loads that world (standalone builds have
        /// no project folder to resolve against); otherwise relative paths are taken from the
        /// Unity project folder.
        /// </summary>
        public static string ResolveDirectory(string dir)
        {
            var args = System.Environment.GetCommandLineArgs();
            int a = System.Array.IndexOf(args, "-bloxWorld");
            if (a >= 0 && a + 1 < args.Length) return Path.GetFullPath(args[a + 1]);
            if (Path.IsPathRooted(dir)) return dir;
            string project = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            return Path.GetFullPath(Path.Combine(project, dir));
        }

        private void OnEnable()
        {
            string dir = ResolvedDirectory;
            if (!File.Exists(Path.Combine(dir, "manifest.json")))
            {
                Debug.LogError($"WorldLoader: no manifest.json in '{dir}'. Generate a world first (see unity/README.md).");
                enabled = false;
                return;
            }
            if (opaqueMaterial == null || transparentMaterial == null)
            {
                Debug.LogError("WorldLoader: assign the BrickBody and BrickTransparent materials (run Blox/Setup Project).");
                enabled = false;
                return;
            }
            try
            {
                World = WorldFiles.Open(dir, verifySha1);
            }
            catch (System.Exception e)
            {
                Debug.LogError($"WorldLoader: cannot open world '{dir}': {e.Message}");
                enabled = false;
                return;
            }
            _builder = new ChunkMeshBuilder(World);
            _studTops = new StudTopsBuffer();
            _planner = new ChunkLodPlanner(World.Spec, World.AvailableChunks);
            _levelOf = c => _renderers.TryGetValue(c, out var r) ? r.Level : -1;
            _root = new GameObject("Chunks").transform;
            _root.SetParent(transform, false);
            _islandRoot = new GameObject("Islands").transform;
            _islandRoot.SetParent(transform, false);
            _islandOpaque = IslandMaterial(opaqueMaterial);
            _islandTransparent = IslandMaterial(transparentMaterial);
            Debug.Log($"WorldLoader: opened '{dir}' with {_planner.Chunks.Count} chunks and {World.IslandCount} islands.");
        }

        private void OnDisable()
        {
            foreach (var job in _inFlight)
            {
                // Completing into a throw-away mesh releases the job's native memory.
                var scratch = new Mesh();
                job.Pending.Complete(scratch);
                Destroy(scratch);
            }
            _inFlight.Clear();
            _busy.Clear();
            _jobsPerChunk.Clear();
            foreach (var r in _renderers.Values)
                if (r != null) Destroy(r.gameObject);
            _renderers.Clear();
            foreach (var r in _islandRenderers.Values)
                if (r != null) Destroy(r.gameObject);
            _islandRenderers.Clear();
            if (_root != null) Destroy(_root.gameObject);
            if (_islandRoot != null) Destroy(_islandRoot.gameObject);
            if (_islandOpaque != null) Destroy(_islandOpaque);
            if (_islandTransparent != null) Destroy(_islandTransparent);
            _builder?.Dispose();
            _builder = null;
            _studTops?.Dispose();
            _studTops = null;
            World = null;
        }

        private void Update()
        {
            BloxShaderGlobals.SetTime(Time.time);
            if (World == null) return;
            CompleteJobs(force: false);
            var cam = viewCamera != null ? viewCamera : Camera.main;
            if (cam != null) ScheduleWork(cam.transform.position);
            if (Time.frameCount % 30 == 0) UnloadUnneeded();
        }

        private void CompleteJobs(bool force)
        {
            for (int n = _inFlight.Count - 1; n >= 0; n--)
            {
                var job = _inFlight[n];
                if (!force && !job.Pending.IsCompleted && Time.frameCount - job.Frame < MaxJobAgeFrames) continue;
                _inFlight.RemoveAt(n);
                var coord = job.Pending.Coord;
                int left = (_jobsPerChunk.TryGetValue(coord, out int c) ? c : 1) - 1;
                if (left <= 0) { _jobsPerChunk.Remove(coord); _busy.Remove(coord); }
                else _jobsPerChunk[coord] = left;
                if (job.Pending.IsIsland) ApplyIsland(job.Pending, job.Level);
                else Apply(job.Pending, job.Level);
            }
        }

        /// <summary>Copy of a brick material for islands: same look, fake studs off (see class docs).</summary>
        private static Material IslandMaterial(Material source)
        {
            var m = new Material(source) { name = source.name + " (islands)" };
            if (m.HasProperty(FakeStudStrengthId)) m.SetFloat(FakeStudStrengthId, 0f);
            return m;
        }

        private void ApplyIsland(PendingChunkMesh pending, int level)
        {
            uint id = pending.IslandId;
            if (!_islandRenderers.TryGetValue(id, out var r))
            {
                var island = World.GetIsland(id);
                if (island == null)
                {
                    // Unloaded meanwhile: complete into a throw-away mesh to release the job memory.
                    var scratch = new Mesh();
                    pending.Complete(scratch);
                    Destroy(scratch);
                    return;
                }
                var go = new GameObject($"island_{id:000000}", typeof(MeshFilter), typeof(MeshRenderer), typeof(ChunkRenderer));
                go.layer = gameObject.layer;
                go.transform.SetParent(_islandRoot, false);
                ChunkMeshBuilder.IslandTransform(island.Pose, out var position, out var rotation);
                go.transform.localPosition = position;
                go.transform.localRotation = rotation;
                r = go.GetComponent<ChunkRenderer>();
                r.Init(pending.Coord, _islandOpaque, _islandTransparent, $"Blox island {id}");
                _islandRenderers[id] = r;
            }
            var result = r.Apply(pending, level);
            if (studRenderer == null) return;
            if (level == 0) studRenderer.SetIsland(id, result.Studs); // already world space
            else studRenderer.RemoveIsland(id);
        }

        private void Apply(PendingChunkMesh pending, int level)
        {
            var coord = pending.Coord;
            if (!_renderers.TryGetValue(coord, out var r))
            {
                var go = new GameObject(coord.ToString(), typeof(MeshFilter), typeof(MeshRenderer), typeof(ChunkRenderer));
                go.layer = gameObject.layer;
                go.transform.SetParent(_root, false);
                go.transform.localPosition = new Vector3((float)World.Spec.ChunkOriginX(coord), 0f, (float)World.Spec.ChunkOriginZ(coord));
                r = go.GetComponent<ChunkRenderer>();
                r.Init(coord, opaqueMaterial, transparentMaterial);
                _renderers[coord] = r;
            }
            var result = r.Apply(pending, level);
            if (level == 0)
            {
                if (studRenderer != null) studRenderer.SetChunk(coord, result.Studs);
                _studTops.SetChunk(coord, result.Studs);
            }
            else
            {
                if (studRenderer != null) studRenderer.RemoveChunk(coord);
                _studTops.ClearChunk(coord);
            }
        }

        private void ScheduleWork(Vector3 cameraPos)
        {
            if (_inFlight.Count >= maxJobsInFlight) return;
            var work = _planner.Plan(cameraPos, lod, maxDistance, _levelOf, _busy);
            int scheduled = 0;
            foreach (var w in work)
            {
                if (scheduled >= maxSchedulesPerFrame || _inFlight.Count >= maxJobsInFlight) break;
                if (w.Level < 0) { Remove(w.Coord); continue; }
                PendingChunkMesh pending;
                try
                {
                    pending = Schedule(w.Coord, w.Level);
                }
                catch (System.Exception e)
                {
                    // A broken chunk file: report once and never retry it (it stays in _busy).
                    Debug.LogError($"WorldLoader: cannot mesh {w.Coord}: {e.Message}");
                    _busy.Add(w.Coord);
                    continue;
                }
                if (pending == null) continue;
                Track(pending, w.Level);
                ScheduleIslands(w.Coord, w.Level);
                scheduled++;
            }
            if (scheduled > 0) JobHandle.ScheduleBatchedJobs();
        }

        private void Track(PendingChunkMesh pending, int level)
        {
            _inFlight.Add(new InFlight { Pending = pending, Level = level, Frame = Time.frameCount });
            _busy.Add(pending.Coord);
            _jobsPerChunk[pending.Coord] = (_jobsPerChunk.TryGetValue(pending.Coord, out int n) ? n : 0) + 1;
        }

        /// <summary>Meshes the islands owned by <paramref name="c"/> at the chunk's new level.</summary>
        private void ScheduleIslands(ChunkCoord c, int level)
        {
            int factor = level == 0 ? 0 : ChunkLodPolicy.Factor(level);
            foreach (uint id in World.IslandsOwnedBy(c))
            {
                try
                {
                    var island = World.LoadIsland(id);
                    if (island == null || island.Data.Count == 0) continue;
                    Track(_builder.ScheduleIsland(island, factor), level);
                }
                catch (System.Exception e)
                {
                    // A broken island file: report it; the chunk itself still shows.
                    Debug.LogError($"WorldLoader: cannot mesh island {id}: {e.Message}");
                }
            }
        }

        private PendingChunkMesh Schedule(ChunkCoord c, int level)
        {
            if (level == 0)
            {
                // Neighbours first, so faces on the chunk border are culled exactly.
                for (int dy = -1; dy <= 1; dy++)
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        var n = new ChunkCoord(c.X + dx, c.Y + dy);
                        if (World.Exists(n)) World.Load(n);
                    }
                return _builder.Schedule(c);
            }
            World.Load(c);
            return _builder.ScheduleLod(c, ChunkLodPolicy.Factor(level));
        }

        private void Remove(ChunkCoord c)
        {
            if (!_renderers.TryGetValue(c, out var r)) return;
            _renderers.Remove(c);
            if (studRenderer != null) studRenderer.RemoveChunk(c);
            _studTops.ClearChunk(c);
            Destroy(r.gameObject);
            foreach (uint id in World.IslandsOwnedBy(c))
            {
                if (!_islandRenderers.TryGetValue(id, out var ir)) continue;
                _islandRenderers.Remove(id);
                if (studRenderer != null) studRenderer.RemoveIsland(id);
                Destroy(ir.gameObject);
            }
        }

        /// <summary>Drops chunk data that no full-detail chunk (or running job) needs.</summary>
        private void UnloadUnneeded()
        {
            _scratch.Clear();
            foreach (var c in World.LoadedChunks)
                if (!IsNeeded(c)) _scratch.Add(c);
            foreach (var c in _scratch) World.Unload(c);
            // Island data stays loaded while its owner is busy or at full detail (picking uses it).
            _islandScratch.Clear();
            foreach (var island in World.LoadedIslands)
            {
                var owner = island.Owner;
                bool needed = _busy.Contains(owner) || (_renderers.TryGetValue(owner, out var r) && r.Level == 0);
                if (!needed) _islandScratch.Add(island.Id);
            }
            foreach (uint id in _islandScratch) World.UnloadIsland(id);
        }

        private bool IsNeeded(ChunkCoord c)
        {
            for (int dy = -1; dy <= 1; dy++)
                for (int dx = -1; dx <= 1; dx++)
                {
                    var n = new ChunkCoord(c.X + dx, c.Y + dy);
                    if (_busy.Contains(n)) return true;
                    if (_renderers.TryGetValue(n, out var r) && r.Level == 0) return true;
                }
            return false;
        }

        /// <summary>Box around every chunk in the manifest (Unity metres); empty if not open.</summary>
        public Bounds ComputeWorldBounds()
        {
            if (_planner == null || _planner.Chunks.Count == 0) return default;
            var b = _planner.BoundsOf(_planner.Chunks[0]);
            foreach (var c in _planner.Chunks) b.Encapsulate(_planner.BoundsOf(c));
            return b;
        }
    }
}
