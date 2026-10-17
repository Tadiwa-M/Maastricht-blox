using System;
using UnityEditor;
using UnityEngine;

namespace Blox.Editor
{
    /// <summary>
    /// Sets serialized fields by name, for settings that have no public setter in the
    /// current URP / Unity version. Every miss is logged instead of failing silently, so a
    /// renamed field in a future package version shows up in the console.
    /// </summary>
    internal sealed class SerializedSettings : IDisposable
    {
        private readonly SerializedObject _so;
        private readonly string _label;

        public SerializedSettings(UnityEngine.Object target)
        {
            _so = new SerializedObject(target);
            _label = target.GetType().Name;
        }

        public SerializedObject Serialized => _so;

        public SerializedProperty Find(string path)
        {
            var p = _so.FindProperty(path);
            if (p == null) Debug.LogWarning($"Blox setup: {_label} has no serialized field '{path}' in this Unity/URP version; set it by hand.");
            return p;
        }

        public void Bool(string path, bool v) { var p = Find(path); if (p != null) p.boolValue = v; }
        public void Int(string path, int v) { var p = Find(path); if (p != null) p.intValue = v; }
        public void Float(string path, float v) { var p = Find(path); if (p != null) p.floatValue = v; }
        public void Ref(string path, UnityEngine.Object v) { var p = Find(path); if (p != null) p.objectReferenceValue = v; }
        public void Str(string path, string v) { var p = Find(path); if (p != null) p.stringValue = v; }
        public void Vec3(string path, UnityEngine.Vector3 v) { var p = Find(path); if (p != null) p.vector3Value = v; }
        public void Vec2(string path, UnityEngine.Vector2 v) { var p = Find(path); if (p != null) p.vector2Value = v; }

        /// <summary>Sets an enum by its C# member name (independent of declaration order).</summary>
        public void EnumByName(string path, string member)
        {
            var p = Find(path);
            if (p == null) return;
            int idx = Array.IndexOf(p.enumNames, member);
            if (idx < 0)
            {
                Debug.LogWarning($"Blox setup: {_label}.{path} has no enum value '{member}' (has: {string.Join(", ", p.enumNames)}).");
                return;
            }
            p.enumValueIndex = idx;
        }

        public void Dispose()
        {
            _so.ApplyModifiedPropertiesWithoutUndo();
            _so.Dispose();
        }
    }
}
