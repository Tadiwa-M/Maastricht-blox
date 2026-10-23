using System.Collections.Generic;
using Blox.Data;
using UnityEngine;

namespace Blox.Rendering
{
    /// <summary>A chunk whose level should change, with its distance for prioritising.</summary>
    public readonly struct ChunkWork
    {
        public readonly ChunkCoord Coord;
        public readonly int Level;      // desired level, -1 = remove
        public readonly float Distance;

        public ChunkWork(ChunkCoord coord, int level, float distance)
        {
            Coord = coord; Level = level; Distance = distance;
        }
    }

    /// <summary>
    /// Decides, for every chunk in the manifest, which HLOD level it should show from the
    /// camera position (distance to the chunk's box, <see cref="ChunkLodPolicy"/> with
    /// hysteresis) and lists the changes nearest first. Allocation-free per frame.
    /// </summary>
    public sealed class ChunkLodPlanner
    {
        private readonly List<ManifestChunk> _chunks;
        private readonly WorldSpec _spec;
        private readonly List<ChunkWork> _work = new List<ChunkWork>(256);
        private static readonly Comparer<ChunkWork> ByDistance = Comparer<ChunkWork>.Create((a, b) => a.Distance.CompareTo(b.Distance));

        public ChunkLodPlanner(WorldSpec spec, IEnumerable<ManifestChunk> chunks)
        {
            _spec = spec;
            _chunks = new List<ManifestChunk>(chunks);
        }

        public IReadOnlyList<ManifestChunk> Chunks => _chunks;

        /// <summary>World-space box of a manifest chunk (Unity metres).</summary>
        public Bounds BoundsOf(ManifestChunk c)
        {
            float x0 = (float)_spec.ChunkOriginX(c.Coord), z0 = (float)_spec.ChunkOriginZ(c.Coord);
            float size = (float)(_spec.ChunkStuds * _spec.StudM);
            var b = new Bounds();
            b.SetMinMax(new Vector3(x0, (float)(c.MinK * _spec.PlateM), z0),
                        new Vector3(x0 + size, (float)(c.MaxK * _spec.PlateM), z0 + size));
            return b;
        }

        /// <summary>
        /// Fills and returns the list of chunks whose desired level differs from
        /// <paramref name="currentLevel"/> (-1 when not shown), skipping <paramref name="busy"/> ones.
        /// </summary>
        public List<ChunkWork> Plan(Vector3 camera, ChunkLodPolicy policy, float maxDistance,
                                    System.Func<ChunkCoord, int> currentLevel, HashSet<ChunkCoord> busy)
        {
            _work.Clear();
            foreach (var c in _chunks)
            {
                var coord = c.Coord;
                if (busy.Contains(coord)) continue;
                var b = BoundsOf(c);
                float d = ChunkLodPolicy.DistanceToBox(camera.x, camera.y, camera.z,
                                                       b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
                int current = currentLevel(coord);
                int desired = d > maxDistance ? -1 : policy.Desired(d, current);
                if (desired != current) _work.Add(new ChunkWork(coord, desired, d));
            }
            _work.Sort(ByDistance);
            return _work;
        }
    }
}
