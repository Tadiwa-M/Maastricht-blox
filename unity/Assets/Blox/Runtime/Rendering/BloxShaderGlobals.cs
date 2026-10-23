using UnityEngine;

namespace Blox.Rendering
{
    /// <summary>
    /// Global shader values shared by the Blox shaders (see Shaders/Include/BloxGlobals.hlsl).
    /// Several components contribute to <c>_BloxStudFade</c>, so it is assembled here.
    /// </summary>
    public static class BloxShaderGlobals
    {
        public static readonly int Night = Shader.PropertyToID("_BloxNight");
        public static readonly int StudFade = Shader.PropertyToID("_BloxStudFade");
        public static readonly int Time = Shader.PropertyToID("_BloxTime");
        public static readonly int StudTops = Shader.PropertyToID("_BloxStudTops");

        private static float _fadeStart = 100f, _fadeEnd = 120f;
        private static bool _studTopsBound;

        /// <summary>Distance band (m) over which Blox/BrickBody fades its fake studs in.</summary>
        public static void SetFakeStudFade(float start, float end)
        {
            _fadeStart = start;
            _fadeEnd = Mathf.Max(end, start + 0.01f);
            PushStudFade();
        }

        public static void SetStudTopsBound(bool bound)
        {
            _studTopsBound = bound;
            PushStudFade();
        }

        public static void SetNight(float night) => Shader.SetGlobalFloat(Night, Mathf.Clamp01(night));

        public static void SetTime(float seconds) => Shader.SetGlobalFloat(Time, seconds);

        private static void PushStudFade() =>
            Shader.SetGlobalVector(StudFade, new Vector4(_fadeStart, _fadeEnd, _studTopsBound ? 1f : 0f, 0f));
    }
}
