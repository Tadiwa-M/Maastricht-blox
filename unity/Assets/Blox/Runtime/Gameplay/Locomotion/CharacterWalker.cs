using System;
using Blox.Data;
using UnityEngine;
// UnityEngine has its own Pose type; ours is the contract pose (yaw clockwise from north).
using Pose = Blox.Data.Pose;
using UnityEngine.InputSystem;

namespace Blox.Gameplay
{
    /// <summary>
    /// Third-person control of a brick figure: WASD / arrow keys walk relative to the camera
    /// (W = away from the camera), Shift runs, the figure turns smoothly toward where it walks
    /// and swings its legs and arms (<see cref="WalkCycle"/>). It stands on the bricks of the
    /// loaded world: each step asks <see cref="GroundProbe"/> for the ground in the column it
    /// moves into (kerbs up to <c>maxStepUpPlates</c> are climbed, walls block and the figure
    /// slides along them). Press the toggle key (C) to take or release control; while in
    /// control the <see cref="MapCameraRig"/> follows the figure and leaves WASD to it.
    /// All maths lives in Gameplay/Core and Blox.Data; this class only reads input and applies poses.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class CharacterWalker : MonoBehaviour
    {
        [SerializeField] private BrickModelRenderer model;
        [Tooltip("Camera the input is relative to (default: Camera.main).")]
        [SerializeField] private Transform cameraTransform;
        [Tooltip("Something that implements Blox.Data.IWorldSource, e.g. the WorldLoader.")]
        [SerializeField] private MonoBehaviour worldSource;

        [Header("Control")]
        [SerializeField] private bool controlActive;
        [SerializeField] private Key toggleKey = Key.C;
        [Tooltip("While in control, make the map camera follow this figure.")]
        [SerializeField] private bool cameraFollows = true;

        [Header("Movement")]
        [SerializeField, Min(0f)] private float walkSpeedMps = 1.4f;
        [SerializeField, Min(0f)] private float runSpeedMps = 3.2f;
        [SerializeField, Min(0f)] private float turnDegPerSec = 540f;
        [SerializeField, Min(0f)] private float heightSharpness = 18f;

        [Header("Ground (plates)")]
        [SerializeField, Min(0)] private int maxStepUpPlates = 3;
        [SerializeField, Min(0)] private int maxDropPlates = 15;
        [SerializeField, Min(1)] private int headroomPlates = 9;

        // Grid units (CONTRACT section 1): a stud is 0.5 m across, a plate 0.2 m tall.
        private const float StudM = 0.5f, PlateM = 0.2f;

        private readonly WalkCycle _walk = new WalkCycle();
        private IWorldSource _source;
        private WorldIndex _world;
        private Func<int, int, int, bool> _solid;
        private MapCameraRig _rig;
        private Vector3 _position;
        private float _yaw, _groundY;
        private int _groundK;

        public bool ControlActive
        {
            get => controlActive;
            set { controlActive = value; ApplyCameraMode(); }
        }

        private void Awake()
        {
            if (model == null) model = GetComponent<BrickModelRenderer>();
            _source = worldSource as IWorldSource;
            if (worldSource != null && _source == null)
                Debug.LogWarning("CharacterWalker: worldSource does not implement IWorldSource; walking on a flat plane.", this);
            _solid = (i, j, k) => _world != null && _world.IsSolid(i, j, k);
            _position = transform.position;
            _groundY = _position.y;
            _groundK = Mathf.RoundToInt(_position.y / PlateM);
            _yaw = transform.eulerAngles.y;
        }

        private void Start() => ApplyCameraMode();

        private void Update()
        {
            float dt = Time.deltaTime;
            _world = _source?.World;
            var kb = Keyboard.current;
            if (kb != null && kb[toggleKey].wasPressedThisFrame) ControlActive = !controlActive;

            float right = 0f, forward = 0f;
            bool run = false;
            if (controlActive && kb != null)
            {
                right = Axis(kb.dKey, kb.rightArrowKey) - Axis(kb.aKey, kb.leftArrowKey);
                forward = Axis(kb.wKey, kb.upArrowKey) - Axis(kb.sKey, kb.downArrowKey);
                run = kb.leftShiftKey.isPressed || kb.rightShiftKey.isPressed;
            }
            var cam = cameraTransform != null ? cameraTransform : Camera.main != null ? Camera.main.transform : null;
            float camYaw = cam != null ? cam.eulerAngles.y : 0f;
            CharacterMotion.MoveDirection(right, forward, camYaw, out float dx, out float dz);

            float speed = run ? runSpeedMps : walkSpeedMps;
            var before = _position;
            if (dx != 0f || dz != 0f)
            {
                var step = new Vector3(dx, 0f, dz) * (speed * dt);
                // Try the full step, then slide along x or z when a wall is in the way.
                if (!TryMove(step) && !TryMove(new Vector3(step.x, 0f, 0f))) TryMove(new Vector3(0f, 0f, step.z));
                _yaw = CharacterMotion.TurnToward(_yaw, dx, dz, turnDegPerSec, dt);
            }
            _position.y = MapCameraMath.Damp(_position.y, _groundY, heightSharpness, dt);

            float moved = new Vector2(_position.x - before.x, _position.z - before.z).magnitude;
            _walk.Step(moved, dt);
            if (model != null)
            {
                model.ApplyPose(new Pose(_position.x, _position.y, _position.z, _yaw));
                model.SetPartPitch("leg_l", -_walk.LegLeftDeg);   // negative = lower end forward
                model.SetPartPitch("leg_r", -_walk.LegRightDeg);
                model.SetPartPitch("arm_l", -_walk.ArmLeftDeg);
                model.SetPartPitch("arm_r", -_walk.ArmRightDeg);
            }
            else
            {
                transform.SetPositionAndRotation(_position, Quaternion.Euler(0f, _yaw, 0f));
            }
        }

        /// <summary>Moves by <paramref name="step"/> if the target column can be stood on (or is open). Returns false when blocked.</summary>
        private bool TryMove(Vector3 step)
        {
            if (step.sqrMagnitude < 1e-12f) return false;
            var target = _position + step;
            if (_world == null)
            {
                _position = target;
                return true;
            }
            int i = Mathf.FloorToInt(target.x / StudM), j = Mathf.FloorToInt(target.z / StudM);
            switch (GroundProbe.Find(_solid, i, j, _groundK, maxStepUpPlates, maxDropPlates, headroomPlates, out int k))
            {
                case GroundResult.Ground:
                    _groundK = k;
                    _groundY = k * PlateM;
                    _position.x = target.x;
                    _position.z = target.z;
                    return true;
                case GroundResult.NoGround:   // open air or unloaded chunk: keep the height
                    _position.x = target.x;
                    _position.z = target.z;
                    return true;
                default:
                    return false;
            }
        }

        private void ApplyCameraMode()
        {
            if (!cameraFollows) return;
            var cam = cameraTransform != null ? cameraTransform : Camera.main != null ? Camera.main.transform : null;
            if (_rig == null && cam != null) _rig = cam.GetComponent<MapCameraRig>();
            if (_rig == null) return;
            _rig.FollowTarget = controlActive ? transform : null;
            _rig.KeyboardPanEnabled = !controlActive;
        }

        private static float Axis(UnityEngine.InputSystem.Controls.KeyControl a, UnityEngine.InputSystem.Controls.KeyControl b) =>
            a.isPressed || b.isPressed ? 1f : 0f;
    }
}
