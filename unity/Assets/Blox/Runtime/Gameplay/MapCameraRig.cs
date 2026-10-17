using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Blox.Gameplay
{
    /// <summary>
    /// Google-Maps-style camera (New Input System): left drag pans (the ground point under the
    /// cursor sticks to it), right drag orbits (horizontal = rotate, vertical = tilt), the
    /// wheel zooms toward the cursor with smooth exponential steps, and the view tilts toward
    /// the horizon as you zoom in. Keys: WASD pan, Q/E rotate, R/F tilt, Z/X zoom.
    /// Optionally drives a URP Bokeh depth of field as a tilt-shift "miniature" effect,
    /// focused on the orbit target.
    /// Picking uses the horizontal plane through the orbit target (y = groundHeight).
    /// </summary>
    [RequireComponent(typeof(Camera))]
    [DisallowMultipleComponent]
    public sealed class MapCameraRig : MonoBehaviour
    {
        [Header("Target (Unity metres)")]
        [SerializeField] private Vector3 target = new Vector3(1024f, 18f, 1024f);
        [Tooltip("Height of the ground plane used for panning and zoom-to-cursor.")]
        [SerializeField] private float groundHeight = 18f;
        [SerializeField] private Vector2 boundsMin = new Vector2(0f, 0f);
        [SerializeField] private Vector2 boundsMax = new Vector2(2048f, 2048f);

        [Header("Zoom")]
        [SerializeField, Min(0.5f)] private float distance = 220f;
        [SerializeField, Min(0.5f)] private float minDistance = 4f;
        [SerializeField, Min(10f)] private float maxDistance = 3200f;
        [Tooltip("Distance multiplier per wheel notch toward the scene (exponential zoom).")]
        [SerializeField, Range(0.5f, 0.98f)] private float zoomRatioPerNotch = 0.8f;
        [SerializeField, Min(0f)] private float zoomSharpness = 12f;

        [Header("Orientation (degrees)")]
        [Tooltip("Heading the camera looks toward, clockwise from north.")]
        [SerializeField] private float yaw = 20f;
        [Tooltip("Tilt from straight down at minimum distance...")]
        [SerializeField, Range(0f, 85f)] private float nearTilt = 66f;
        [Tooltip("...and at maximum distance; interpolated on a log scale in between.")]
        [SerializeField, Range(0f, 85f)] private float farTilt = 6f;
        [SerializeField, Min(1f)] private float nearTiltDistance = 20f;
        [SerializeField, Min(10f)] private float farTiltDistance = 2000f;
        [Tooltip("User tilt added on top of the automatic tilt (right drag vertically).")]
        [SerializeField, Range(-60f, 60f)] private float tiltOffset;
        [SerializeField, Range(0f, 89f)] private float maxTilt = 82f;
        [SerializeField, Min(0f)] private float orbitDegreesPerPixel = 0.25f;
        [SerializeField, Min(0f)] private float tiltDegreesPerPixel = 0.2f;
        [SerializeField, Min(0f)] private float rotateSharpness = 14f;

        [Header("Keyboard")]
        [Tooltip("Pan speed in screen heights (camera distances) per second.")]
        [SerializeField, Min(0f)] private float keyPanSpeed = 0.8f;
        [SerializeField, Min(0f)] private float keyRotateSpeed = 90f;
        [SerializeField, Min(0f)] private float keyZoomNotchesPerSecond = 4f;

        [Header("Tilt-shift (URP Depth of Field, Bokeh)")]
        [SerializeField] private Volume postVolume;
        [SerializeField] private bool tiltShift = true;
        [Tooltip("Bokeh focal length at a 100 m focus distance; scaled with sqrt(distance) so the blur looks alike at every zoom.")]
        [SerializeField, Range(10f, 300f)] private float focalLengthAt100m = 190f;
        [SerializeField, Range(1f, 32f)] private float aperture = 2.2f;

        private Camera _camera;
        private DepthOfField _dof;
        private Vector3 _desiredTarget;
        private float _desiredDistance, _desiredYaw, _desiredTiltOffset;
        private bool _panning;
        private Vector3 _panGrab;

        public Vector3 Target => target;
        public float Distance => distance;
        public float Yaw => yaw;
        public float Tilt => CurrentTilt();

        /// <summary>Moves the orbit target (and ground plane) immediately, e.g. to frame a world.</summary>
        public void Focus(Vector3 newTarget, float newDistance)
        {
            target = _desiredTarget = newTarget;
            groundHeight = newTarget.y;
            distance = _desiredDistance = Mathf.Clamp(newDistance, minDistance, maxDistance);
            ApplyTransform();
        }

        public void SetBounds(Vector2 min, Vector2 max)
        {
            boundsMin = min;
            boundsMax = max;
        }

        private void Awake()
        {
            _camera = GetComponent<Camera>();
            _desiredTarget = target;
            _desiredDistance = distance;
            _desiredYaw = yaw;
            _desiredTiltOffset = tiltOffset;
        }

        private void Start()
        {
            if (postVolume != null && postVolume.profile != null && postVolume.profile.TryGet(out DepthOfField dof))
                _dof = dof; // Volume.profile is a runtime copy: the profile asset stays untouched.
            ApplyTransform();
        }

        private void LateUpdate()
        {
            float dt = Time.unscaledDeltaTime;
            HandleMouse();
            HandleKeyboard(dt);

            _desiredDistance = Mathf.Clamp(_desiredDistance, minDistance, maxDistance);
            _desiredTarget.x = Mathf.Clamp(_desiredTarget.x, boundsMin.x, boundsMax.x);
            _desiredTarget.z = Mathf.Clamp(_desiredTarget.z, boundsMin.y, boundsMax.y);
            _desiredTarget.y = groundHeight;

            distance = MapCameraMath.Damp(distance, _desiredDistance, zoomSharpness, dt);
            if (!_panning)
            {
                target.x = MapCameraMath.Damp(target.x, _desiredTarget.x, zoomSharpness, dt);
                target.z = MapCameraMath.Damp(target.z, _desiredTarget.z, zoomSharpness, dt);
            }
            target.y = groundHeight;
            yaw = MapCameraMath.DampAngle(yaw, _desiredYaw, rotateSharpness, dt);
            tiltOffset = MapCameraMath.Damp(tiltOffset, _desiredTiltOffset, rotateSharpness, dt);

            ApplyTransform();
            UpdateDepthOfField();
        }

        private float CurrentTilt()
        {
            float auto = MapCameraMath.TiltForDistance(distance, nearTiltDistance, nearTilt, farTiltDistance, farTilt);
            return Mathf.Clamp(auto + tiltOffset, 0f, maxTilt);
        }

        private void ApplyTransform()
        {
            float tilt = CurrentTilt();
            MapCameraMath.OrbitOffset(yaw, tilt, distance, out float ox, out float oy, out float oz);
            transform.SetPositionAndRotation(target + new Vector3(ox, oy, oz), Quaternion.Euler(90f - tilt, yaw, 0f));
            if (_camera == null) _camera = GetComponent<Camera>();
            _camera.nearClipPlane = Mathf.Clamp(distance * 0.01f, 0.05f, 5f);
            _camera.farClipPlane = Mathf.Max(4000f, distance * 6f);
        }

        private void HandleMouse()
        {
            var mouse = Mouse.current;
            if (mouse == null) return;
            Vector2 pos = mouse.position.ReadValue();
            Vector2 delta = mouse.delta.ReadValue();

            // Pan: keep the grabbed ground point under the cursor.
            if (mouse.leftButton.wasPressedThisFrame && GroundUnder(pos, out _panGrab))
                _panning = true;
            if (_panning && mouse.leftButton.isPressed)
            {
                if (GroundUnder(pos, out var now))
                {
                    var shift = _panGrab - now;
                    target += new Vector3(shift.x, 0f, shift.z);
                    target.x = Mathf.Clamp(target.x, boundsMin.x, boundsMax.x);
                    target.z = Mathf.Clamp(target.z, boundsMin.y, boundsMax.y);
                    _desiredTarget = target;
                    ApplyTransform();
                }
            }
            if (mouse.leftButton.wasReleasedThisFrame) _panning = false;

            // Orbit.
            if (mouse.rightButton.isPressed)
            {
                _desiredYaw += delta.x * orbitDegreesPerPixel;
                _desiredTiltOffset = Mathf.Clamp(_desiredTiltOffset + delta.y * tiltDegreesPerPixel, -60f, 60f); // drag up = toward the horizon
            }

            // Zoom toward the cursor.
            float notches = NormalizeScroll(mouse.scroll.ReadValue().y);
            if (Mathf.Abs(notches) > 1e-3f) ZoomAt(pos, notches);
        }

        private void HandleKeyboard(float dt)
        {
            var kb = Keyboard.current;
            if (kb == null) return;
            float h = (kb.dKey.isPressed ? 1f : 0f) - (kb.aKey.isPressed ? 1f : 0f);
            float v = (kb.wKey.isPressed ? 1f : 0f) - (kb.sKey.isPressed ? 1f : 0f);
            if (h != 0f || v != 0f)
            {
                var rot = Quaternion.Euler(0f, yaw, 0f);
                var move = (rot * Vector3.right * h + rot * Vector3.forward * v) * (keyPanSpeed * distance * dt);
                _desiredTarget += move;
            }
            float r = (kb.eKey.isPressed ? 1f : 0f) - (kb.qKey.isPressed ? 1f : 0f);
            _desiredYaw += r * keyRotateSpeed * dt;
            float t = (kb.rKey.isPressed ? 1f : 0f) - (kb.fKey.isPressed ? 1f : 0f);
            _desiredTiltOffset = Mathf.Clamp(_desiredTiltOffset + t * 40f * dt, -60f, 60f);
            float z = (kb.zKey.isPressed ? 1f : 0f) - (kb.xKey.isPressed ? 1f : 0f);
            if (z != 0f) _desiredDistance *= MapCameraMath.ZoomFactor(z * keyZoomNotchesPerSecond * dt, zoomRatioPerNotch);
        }

        private void ZoomAt(Vector2 screenPos, float notches)
        {
            float before = _desiredDistance;
            float after = Mathf.Clamp(before * MapCameraMath.ZoomFactor(notches, zoomRatioPerNotch), minDistance, maxDistance);
            if (Mathf.Approximately(before, after)) return;
            _desiredDistance = after;
            if (!GroundUnder(screenPos, out var pivot)) return;
            MapCameraMath.ZoomAbout(_desiredTarget.x, _desiredTarget.z, pivot.x, pivot.z, after / before, out float nx, out float nz);
            _desiredTarget.x = nx;
            _desiredTarget.z = nz;
        }

        /// <summary>
        /// Wheel notches from the Input System scroll value: Windows reports 120 per notch
        /// unless the project uses uniform scroll deltas (1 per notch); both are accepted.
        /// </summary>
        private static float NormalizeScroll(float y) => Mathf.Abs(y) >= 20f ? y / 120f : y;

        private bool GroundUnder(Vector2 screenPos, out Vector3 hit)
        {
            hit = default;
            if (_camera == null) return false;
            var ray = _camera.ScreenPointToRay(new Vector3(screenPos.x, screenPos.y, 0f));
            if (!MapCameraMath.RayPlaneY(ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z,
                                         groundHeight, out float hx, out float hz))
                return false;
            // Ignore hits beyond the horizon haze (near-parallel rays).
            if ((new Vector3(hx, groundHeight, hz) - ray.origin).sqrMagnitude > 25f * maxDistance * maxDistance) return false;
            hit = new Vector3(hx, groundHeight, hz);
            return true;
        }

        private void UpdateDepthOfField()
        {
            if (_dof == null) return;
            _dof.active = tiltShift;
            if (!tiltShift) return;
            _dof.mode.Override(DepthOfFieldMode.Bokeh);
            _dof.focusDistance.Override(distance);
            _dof.focalLength.Override(MapCameraMath.TiltShiftFocalLength(distance, focalLengthAt100m));
            _dof.aperture.Override(aperture);
        }
    }
}
