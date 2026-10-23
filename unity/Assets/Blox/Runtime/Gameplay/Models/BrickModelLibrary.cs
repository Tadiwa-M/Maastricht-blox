using System.Collections.Generic;
using System.IO;
using Blox.Data;
using UnityEngine;

namespace Blox.Gameplay
{
    /// <summary>
    /// Loads brick models and the catalogue/palette they need from the contract folder
    /// (default <c>../contract</c>, relative to the Unity project folder, like WorldLoader's
    /// world directory). Everything is cached, so many buses share one parse.
    /// </summary>
    public static class BrickModelLibrary
    {
        public sealed class Tables
        {
            public Catalogue Catalogue;
            public BrickTypeInfo[] Types;
            public PaletteColor[] Colors;
        }

        private static readonly Dictionary<string, Tables> TablesByDir = new Dictionary<string, Tables>();
        private static readonly Dictionary<string, BrickModel> ModelsByPath = new Dictionary<string, BrickModel>();

        /// <summary>Absolute path of a folder given relative to the Unity project folder (the one holding Assets/).</summary>
        public static string Resolve(string dir)
        {
            if (Path.IsPathRooted(dir)) return dir;
            string project = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            return Path.GetFullPath(Path.Combine(project, dir));
        }

        /// <summary>Catalogue + palette tables from <paramref name="contractDir"/>.</summary>
        public static Tables LoadTables(string contractDir)
        {
            string dir = Resolve(contractDir);
            if (TablesByDir.TryGetValue(dir, out var t)) return t;
            var catalogue = Catalogue.Parse(File.ReadAllText(Path.Combine(dir, "brick_catalogue.json")));
            var palette = Palette.Parse(File.ReadAllText(Path.Combine(dir, "palette.json")));
            t = new Tables { Catalogue = catalogue, Types = catalogue.ToTable(), Colors = palette.ToTable() };
            TablesByDir[dir] = t;
            return t;
        }

        /// <summary>Model <c>models/&lt;name&gt;.json</c> from <paramref name="contractDir"/>, validated against the catalogue.</summary>
        public static BrickModel LoadModel(string contractDir, string name)
        {
            string path = Path.Combine(Resolve(contractDir), "models", name + ".json");
            if (ModelsByPath.TryGetValue(path, out var m)) return m;
            m = BrickModel.Parse(File.ReadAllText(path), LoadTables(contractDir).Catalogue);
            ModelsByPath[path] = m;
            return m;
        }
    }
}
