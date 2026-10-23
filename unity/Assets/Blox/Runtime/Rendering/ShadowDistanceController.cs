using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Blox.Rendering
{
    /// <summary>
    /// Fits the URP main-light shadow range and its 4 cascade splits to the camera's height
    /// above the ground: a few dozen metres (crisp stud shadows) at street level, up to
    /// ~1.5 km when looking at the whole city. Writes the active URP asset at runtime and
    /// restores the original values when disabled, so play mode leaves the asset unchanged.
    /// </summary>
    [RequireComponent(typeof(Camera))]
    [DisallowMultipleComponent]
    public sealed class ShadowDistanceController : MonoBehaviour
    {
        [Tooltip("Unity Y of the typical ground (the test scene and Maastricht centre lie around 15-25 m).")]
        [SerializeField] private float groundHeight = 18f;
        [Tooltip("Extra shadow distance per metre of camera altitude.")]
        [SerializeField, Min(0.5f)] private float distancePerMetre = 4f;
        [SerializeField, Min(5f)] private float minDistance = 60f;
        [SerializeField, Min(10f)] private float maxDistance = 1500f;
        [Tooltip("0 = uniform cascade splits, 1 = logarithmic.")]
        [SerializeField, Range(0f, 1f)] private float splitLambda = 0.85f;
        [Tooltip("Only touch the asset when the distance changes by more than this fraction.")]
        [SerializeField, Range(0f, 0.5f)] private float tolerance = 0.05f;

        private UniversalRenderPipelineAsset _asset;
        private float _origDistance;
        private int _origCascades;
        private Vector3 _origSplit;

        private void OnEnable()
        {
            _asset = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
            if (_asset == null)
            {
                Debug.LogWarning("ShadowDistanceController: the active render pipeline is not URP; nothing to drive.");
                enabled = false;
                return;
            }
            _origDistance = _asset.shadowDistance;
            _origCascades = _asset.shadowCascadeCount;
            _origSplit = _asset.cascade4Split;
            _asset.shadowCascadeCount = 4;
        }

        private void OnDisable()
        {
            if (_asset == null) return;
            _asset.shadowDistance = _origDistance;
            _asset.shadowCascadeCount = _origCascades;
            _asset.cascade4Split = _origSplit;
        }

        private void LateUpdate()
        {
            float altitude = Mathf.Max(0f, transform.position.y - groundHeight);
            float distance = ShadowCascadeMath.ShadowDistance(altitude, distancePerMetre, minDistance, maxDistance);
            if (!ShadowCascadeMath.Changed(_asset.shadowDistance, distance, tolerance)) return;

            // The nearest ground is roughly as far away as the camera is high.
            float near = Mathf.Clamp(altitude * 0.5f, 2f, distance * 0.2f);
            ShadowCascadeMath.PracticalSplits(near, distance, splitLambda, out float s1, out float s2, out float s3);
            _asset.shadowDistance = distance;
            _asset.cascade4Split = new Vector3(s1, s2, s3);
        }
    }
}
