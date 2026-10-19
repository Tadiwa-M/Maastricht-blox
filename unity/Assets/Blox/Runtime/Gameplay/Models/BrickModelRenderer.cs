using System;
using System.Collections.Generic;
using Blox.Data;
using Blox.Meshing;
using Blox.Meshing.Core;
using UnityEngine;
// UnityEngine has its own Pose type; ours is the contract pose (yaw clockwise from north).
using Pose = Blox.Data.Pose;
using UnityEngine.Rendering;

namespace Blox.Gameplay
{
    /// <summary>
    /// Shows a brick model (CONTRACT 7.1: bus, boat, character) as a small hierarchy:
    /// <code>
    /// this GameObject      = the model origin (its pivot, on the ground); move it with ApplyPose
    ///   body               = all bricks without a part
    ///   leg_l, wheel_fl ... = one child per part, placed at the part's pivot
    /// </code>
    /// Parts turn about their own local x axis (the model's i axis): see <see cref="SetPartPitch"/>.
    /// The model is built in Awake from <c>contract/models/&lt;modelName&gt;.json</c> (or a
    /// TextAsset) with the same brick geometry and shaders as the city.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class BrickModelRenderer : MonoBehaviour
    {
        [Tooltip("Model file name without .json, under <contract>/models/.")]
        [SerializeField] private string modelName = "bus";
        [Tooltip("Optional: use this JSON instead of the file (same format).")]
        [SerializeField] private TextAsset modelJson;
        [Tooltip("Contract folder, relative to the Unity project folder.")]
        [SerializeField] private string contractDirectory = "../contract";
        [SerializeField] private Material opaqueMaterial;
        [SerializeField] private Material transparentMaterial;
        [SerializeField] private ShadowCastingMode shadows = ShadowCastingMode.On;

        private readonly Dictionary<string, Transform> _parts = new Dictionary<string, Transform>(StringComparer.Ordinal);
        private readonly List<Mesh> _meshes = new List<Mesh>();
        private readonly List<GameObject> _children = new List<GameObject>();

        public BrickModel Model { get; private set; }
        public IEnumerable<string> PartNames => _parts.Keys;

        private void Awake()
        {
            if (Model == null) Build();
        }

        private void OnDestroy()
        {
            foreach (var m in _meshes) if (m != null) Destroy(m);
            _meshes.Clear();
        }

        /// <summary>(Re)builds the child objects from the model file. Logs and returns false on errors.</summary>
        public bool Build()
        {
            try
            {
                var tables = BrickModelLibrary.LoadTables(contractDirectory);
                Model = modelJson != null
                    ? BrickModel.Parse(modelJson.text, tables.Catalogue)
                    : BrickModelLibrary.LoadModel(contractDirectory, modelName);
                Clear();
                AddPart(-1, "body", tables);
                for (int p = 0; p < Model.Parts.Count; p++) AddPart(p, Model.Parts[p].Name, tables);
                return true;
            }
            catch (Exception e)
            {
                Debug.LogError($"BrickModelRenderer: cannot build model '{modelName}': {e.Message}", this);
                return false;
            }
        }

        /// <summary>Places and turns the whole model (shared pose type: buses, followers, walkers).</summary>
        public void ApplyPose(Pose pose) =>
            transform.SetPositionAndRotation(new Vector3(pose.X, pose.Y, pose.Z), Quaternion.Euler(0f, pose.YawDeg, 0f));

        public bool HasPart(string part) => _parts.ContainsKey(part);

        /// <summary>
        /// Turns a part about its pivot's local x (i) axis, in Unity degrees: positive tips the
        /// part's top toward the front (a wheel rolling forward), so a limb's lower end swings
        /// <i>back</i>. For a forward leg swing pass a negative angle (CharacterWalker does).
        /// </summary>
        public void SetPartPitch(string part, float degrees)
        {
            if (_parts.TryGetValue(part, out var t)) t.localRotation = Quaternion.Euler(degrees, 0f, 0f);
        }

        /// <summary>Height of a part's pivot above the model origin (m): the radius of a wheel part.</summary>
        public float PartPivotHeight(string part) => _parts.TryGetValue(part, out var t) ? t.localPosition.y : 0f;

        private void Clear()
        {
            foreach (var go in _children) if (go != null) Destroy(go);
            _children.Clear();
            _parts.Clear();
            foreach (var m in _meshes) if (m != null) Destroy(m);
            _meshes.Clear();
        }

        private void AddPart(int index, string name, BrickModelLibrary.Tables tables)
        {
            var mesh = ModelMeshFactory.BuildPart(Model, index, tables.Types, tables.Colors);
            var go = new GameObject(name);
            _children.Add(go);
            go.transform.SetParent(transform, false);
            ModelMesherCore.PartOffset(Model, index, out float x, out float y, out float z);
            go.transform.localPosition = new Vector3(x, y, z);
            if (index >= 0) _parts[name] = go.transform;
            if (mesh == null) return;
            _meshes.Add(mesh);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterials = new[] { opaqueMaterial, transparentMaterial };
            r.shadowCastingMode = shadows;
        }
    }
}
