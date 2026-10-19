using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Blox.Data;
using Blox.Gameplay;
using Blox.Rendering;
using UnityEngine;

namespace Blox.Editor
{
    /// <summary>
    /// Moving things for the look-test scene, found from the world data (no hard-coded
    /// coordinates, same idea as the browser viewer's demo):
    /// <list type="bullet">
    /// <item>a <b>bus</b> (contract/models/bus.json) on a loop along the road: the longest run of
    ///       asphalt tops across the world, east on the south lane and back west on the north lane
    ///       (right-hand traffic), turning round beyond the world's edge;</item>
    /// <item>a <b>walking figure</b> (contract/models/character.json) on open ground near the
    ///       centre; press C in Play mode to control it with WASD (Shift runs).</item>
    /// </list>
    /// </summary>
    internal static class LookTestActors
    {
        private const float StudM = 0.5f, PlateM = 0.2f;
        private const float LoopOverhangM = 14f;   // the bus turns round this far past the edge

        public static void Spawn(string worldDir, BloxAssets assets, Camera cam, WorldLoader loader)
        {
            if (!File.Exists(Path.Combine(worldDir, "manifest.json"))) return;
            WorldIndex world;
            List<ManifestChunk> chunks;
            try
            {
                world = WorldFiles.Open(worldDir);
                chunks = CentralChunks(world.AvailableChunks.ToList());
                foreach (var c in chunks) world.Load(c.Coord);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"Blox: no actors, cannot read the world: {e.Message}");
                return;
            }
            if (chunks.Count == 0) return;
            int i0 = chunks.Min(c => c.Cx) * 64, i1 = (chunks.Max(c => c.Cx) + 1) * 64;
            int j0 = chunks.Min(c => c.Cy) * 64, j1 = (chunks.Max(c => c.Cy) + 1) * 64;

            if (FindRoad(world, i0, i1, j0, j1, out int roadJ0, out int roadJ1, out int roadTopK))
                SpawnBus(assets, i0, i1, roadJ0, roadJ1, roadTopK);
            else
                Debug.LogWarning("Blox: no asphalt road found in the world; the look test has no bus.");

            if (FindStandSpot(world, (i0 + i1) / 2, (j0 + j1) / 2, out var spot))
                SpawnWalker(assets, cam, loader, spot);
        }

        /// <summary>
        /// The chunks the actors use: all of a small world (the look test is one chunk), or the
        /// 3 x 3 block around the middle of a big one (loading a whole city in the editor is slow).
        /// </summary>
        private static List<ManifestChunk> CentralChunks(List<ManifestChunk> all)
        {
            if (all.Count <= 9) return all;
            double mx = all.Average(c => c.Cx), my = all.Average(c => c.Cy);
            var mid = all.OrderBy(c => (c.Cx - mx) * (c.Cx - mx) + (c.Cy - my) * (c.Cy - my)).First();
            return all.Where(c => Math.Abs(c.Cx - mid.Cx) <= 1 && Math.Abs(c.Cy - mid.Cy) <= 1).ToList();
        }

        /// <summary>Longest north-south run of road tops (asphalt, or white lane paint) in a few columns.</summary>
        private static bool FindRoad(WorldIndex world, int i0, int i1, int j0, int j1, out int runJ0, out int runJ1, out int topK)
        {
            runJ0 = runJ1 = topK = 0;
            int best = 0;
            for (int i = i0 + 4; i < i1; i += Math.Max(1, (i1 - i0) / 8))
            {
                int start = -1, k = 0;
                for (int j = j0; j <= j1; j++)
                {
                    int top = 0;
                    bool road = j < j1 && IsRoad(world, i, j, out top);
                    if (road && start < 0) { start = j; k = top; }
                    if (!road && start >= 0)
                    {
                        if (j - start > best) { best = j - start; runJ0 = start; runJ1 = j - 1; topK = k; }
                        start = -1;
                    }
                }
            }
            return best >= 4;
        }

        private static bool IsRoad(WorldIndex world, int i, int j, out int top)
        {
            top = world.ColumnTop(i, j);
            if (top <= 0 || !world.TryGetBrick(i, j, top - 1, out var hit)) return false;
            string name = world.Palette[hit.Record.color]?.Name ?? "";
            return name == "asphalt" || name == "white";
        }

        private static void SpawnBus(BloxAssets assets, int i0, int i1, int roadJ0, int roadJ1, int topK)
        {
            float y = topK * PlateM;
            float width = (roadJ1 + 1 - roadJ0) * StudM;
            float south = roadJ0 * StudM + width * 0.25f, north = roadJ0 * StudM + width * 0.75f;
            float west = i0 * StudM - LoopOverhangM, east = i1 * StudM + LoopOverhangM;
            var points = new[]
            {
                new Vector3(west, y, south), new Vector3(east, y, south),   // eastbound, south lane
                new Vector3(east, y, north), new Vector3(west, y, north),   // westbound, north lane
            };
            var go = new GameObject("Bus");
            var model = go.AddComponent<BrickModelRenderer>();
            using (var s = new SerializedSettings(model))
            {
                s.Str("modelName", "bus");
                s.Ref("opaqueMaterial", assets.BrickBody);
                s.Ref("transparentMaterial", assets.BrickTransparent);
            }
            var follower = go.AddComponent<PathFollower>();
            using (var s = new SerializedSettings(follower))
            {
                s.Ref("model", model);
                s.Vec3Array("points", points);
                s.Bool("loop", true);
                s.Float("speedMps", 6f);
                s.Float("turnRadiusM", Mathf.Max(1.5f, (north - south) * 0.75f));
                s.Float("startDistanceM", LoopOverhangM + 10f);
            }
            go.transform.position = points[0];
        }

        /// <summary>A column near (ci, cj) whose top is the most common ground level and has headroom.</summary>
        private static bool FindStandSpot(WorldIndex world, int ci, int cj, out Vector3 spot)
        {
            spot = default;
            var tops = new Dictionary<int, int>();
            for (int di = -12; di <= 12; di++)
                for (int dj = -12; dj <= 12; dj++)
                {
                    int t = world.ColumnTop(ci + di, cj + dj);
                    if (t > 0) tops[t] = tops.TryGetValue(t, out int n) ? n + 1 : 1;
                }
            if (tops.Count == 0) return false;
            int ground = tops.OrderByDescending(kv => kv.Value).First().Key;
            for (int r = 0; r <= 12; r++)
                for (int di = -r; di <= r; di++)
                    for (int dj = -r; dj <= r; dj++)
                    {
                        if (Math.Max(Math.Abs(di), Math.Abs(dj)) != r) continue;
                        int i = ci + di, j = cj + dj;
                        if (world.ColumnTop(i, j) != ground) continue;
                        spot = new Vector3((i + 0.5f) * StudM, ground * PlateM, (j + 0.5f) * StudM);
                        return true;
                    }
            return false;
        }

        private static void SpawnWalker(BloxAssets assets, Camera cam, WorldLoader loader, Vector3 spot)
        {
            var go = new GameObject("Walker");
            go.transform.position = spot;
            var model = go.AddComponent<BrickModelRenderer>();
            using (var s = new SerializedSettings(model))
            {
                s.Str("modelName", "character");
                s.Ref("opaqueMaterial", assets.BrickBody);
                s.Ref("transparentMaterial", assets.BrickTransparent);
            }
            var walker = go.AddComponent<CharacterWalker>();
            using (var s = new SerializedSettings(walker))
            {
                s.Ref("model", model);
                s.Ref("cameraTransform", cam.transform);
                s.Ref("worldSource", loader);
                s.Bool("controlActive", false);
            }
        }
    }
}
