using Blox.Data;
using UnityEngine;

namespace Blox.Gameplay
{
    /// <summary>
    /// Drives a <see cref="BrickModelRenderer"/> along a path at a constant speed: each frame
    /// distance += speed * dt, then <see cref="PathMover.Evaluate"/> gives the pose (corners
    /// smoothed over <c>turnRadiusM</c>), exactly like live buses. Wheel parts ("wheel*") roll
    /// without slipping; figures with leg/arm parts get a <see cref="WalkCycle"/>.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class PathFollower : MonoBehaviour
    {
        [SerializeField] private BrickModelRenderer model;
        [Tooltip("Path points in Unity metres (x east, y up, z north).")]
        [SerializeField] private Vector3[] points = new Vector3[0];
        [SerializeField] private bool loop = true;
        [SerializeField, Min(0f)] private float speedMps = 5f;
        [SerializeField, Min(0f)] private float turnRadiusM = 3f;
        [SerializeField] private float startDistanceM;

        private PathMover _mover;
        private WalkCycle _walk;
        private float _distance;

        public float DistanceM => _distance;
        public float SpeedMps { get => speedMps; set => speedMps = Mathf.Max(0f, value); }

        /// <summary>Replaces the path (e.g. from code) and restarts at <paramref name="startM"/>.</summary>
        public void SetPath(Vector3[] newPoints, bool closed, float startM = 0f)
        {
            points = newPoints;
            loop = closed;
            _distance = startM;
            Rebuild();
        }

        private void Awake()
        {
            if (model == null) model = GetComponent<BrickModelRenderer>();
            _distance = startDistanceM;
            Rebuild();
        }

        private void Rebuild()
        {
            _mover = null;
            if (points == null || points.Length < 2) return;
            var x = new float[points.Length];
            var y = new float[points.Length];
            var z = new float[points.Length];
            for (int n = 0; n < points.Length; n++) { x[n] = points[n].x; y[n] = points[n].y; z[n] = points[n].z; }
            _mover = new PathMover(x, y, z, loop, turnRadiusM);
        }

        private void Update()
        {
            if (_mover == null || model == null) return;
            float dt = Time.deltaTime;
            float step = speedMps * dt;
            _distance += step;
            if (loop && _distance > _mover.LengthM * 1000f) _distance = (float)_mover.Normalize(_distance); // keep float precision
            model.ApplyPose(_mover.Evaluate(_distance));
            AnimateParts(step, dt);
        }

        private static readonly string[] Limbs = { "leg_l", "leg_r", "arm_l", "arm_r" };

        private void AnimateParts(float step, float dt)
        {
            if (model.HasPart("leg_l") || model.HasPart("leg_r"))
            {
                _walk ??= new WalkCycle();
                _walk.Step(step, dt);
                foreach (var limb in Limbs) model.SetPartPitch(limb, -_walk.AngleFor(limb)); // negative = swing forward
            }
            foreach (var part in model.PartNames)
            {
                if (!part.StartsWith("wheel", System.StringComparison.Ordinal)) continue;
                // Roll without slipping: angle = distance / radius; the pivot height is the radius.
                float r = Mathf.Max(0.05f, model.PartPivotHeight(part));
                model.SetPartPitch(part, Mathf.Repeat(_distance / r * Mathf.Rad2Deg, 360f));
            }
        }
    }
}
