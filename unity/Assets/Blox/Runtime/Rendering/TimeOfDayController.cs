using UnityEngine;
using DateTime = System.DateTime;
using UnityEngine.Rendering;

namespace Blox.Rendering
{
    /// <summary>
    /// Drives the directional light from the real sun position over Maastricht
    /// (<see cref="SolarPosition"/>): direction, colour temperature and intensity; at night the
    /// same light becomes a dim, cool moon. Also sets the trilight ambient, reflection
    /// intensity, procedural-skybox exposure and the global <c>_BloxNight</c> (lit windows,
    /// lamps) used by the Blox shaders.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class TimeOfDayController : MonoBehaviour
    {
        public enum ClockMode
        {
            /// <summary>The computer's clock (UTC), plus an optional offset.</summary>
            RealTime,
            /// <summary>A fixed local Maastricht date and time (inspector).</summary>
            Manual,
            /// <summary>Starts at the real time and runs <c>timeScale</c> times faster.</summary>
            Accelerated,
        }

        private static readonly int ExposureId = Shader.PropertyToID("_Exposure");

        [SerializeField] private Light sun;
        [SerializeField] private ClockMode clock = ClockMode.RealTime;
        [Tooltip("RealTime: hours added to the real clock.")]
        [SerializeField] private float offsetHours;
        [Tooltip("Manual: year.")]
        [SerializeField] private int manualYear = 2026;
        [Tooltip("Manual: day of the year (172 = 21 June).")]
        [SerializeField, Range(1, 366)] private int manualDayOfYear = 172;
        [Tooltip("Manual: local Maastricht time (CET/CEST) in hours.")]
        [SerializeField, Range(0f, 24f)] private float manualLocalHour = 16.5f;
        [Tooltip("Accelerated: simulated seconds per real second.")]
        [SerializeField, Min(0f)] private float timeScale = 600f;
        [SerializeField] private double latitude = SolarPosition.MaastrichtLatDeg;
        [SerializeField] private double longitude = SolarPosition.MaastrichtLonDeg;

        [Header("Light")]
        [SerializeField, Min(0f)] private float sunMaxIntensity = 2.2f;
        [SerializeField, Min(0f)] private float moonIntensity = 0.12f;
        [SerializeField, Range(1000f, 4000f)] private float horizonKelvin = 1900f;
        [SerializeField, Range(4000f, 9000f)] private float noonKelvin = 5900f;
        [SerializeField, Range(4000f, 12000f)] private float moonKelvin = 8500f;
        [Tooltip("Elevation (deg) of the moon light at night; its azimuth is opposite the sun.")]
        [SerializeField, Range(10f, 80f)] private float moonElevation = 38f;
        [Tooltip("The shadow-casting light never goes lower than this (deg): long dawn shadows without grazing artefacts.")]
        [SerializeField, Range(0f, 15f)] private float minLightElevation = 4f;

        [Header("Night")]
        [SerializeField] private float nightStartElevation = 4f;
        [SerializeField] private float nightFullElevation = -6f;

        [Header("Ambient")]
        [SerializeField] private bool driveAmbient = true;
        [SerializeField] private Color daySky = new Color(0.52f, 0.62f, 0.78f);
        [SerializeField] private Color dayEquator = new Color(0.46f, 0.47f, 0.47f);
        [SerializeField] private Color dayGround = new Color(0.24f, 0.22f, 0.19f);
        [SerializeField] private Color duskSky = new Color(0.42f, 0.36f, 0.42f);
        [SerializeField] private Color duskEquator = new Color(0.62f, 0.40f, 0.28f);
        [SerializeField] private Color nightSky = new Color(0.035f, 0.05f, 0.09f);
        [SerializeField] private Color nightEquator = new Color(0.03f, 0.035f, 0.05f);
        [SerializeField] private Color nightGround = new Color(0.015f, 0.015f, 0.02f);

        private DateTime _acceleratedStartUtc;
        private float _acceleratedStartRealtime;
        private Material _skyInstance;
        private Material _skyOriginal;

        public DateTime CurrentUtc { get; private set; }
        public SunAngles CurrentSun { get; private set; }
        public DaylightState CurrentState { get; private set; }

        private void OnEnable()
        {
            _acceleratedStartUtc = DateTime.UtcNow;
            _acceleratedStartRealtime = Time.realtimeSinceStartup;
            if (sun == null) sun = RenderSettings.sun;
            if (sun != null)
            {
                sun.type = LightType.Directional;
                sun.useColorTemperature = true;
                if (sun.shadows == LightShadows.None) sun.shadows = LightShadows.Soft;
            }
            // Work on a copy of the skybox so play mode never edits the material asset.
            _skyOriginal = RenderSettings.skybox;
            if (_skyOriginal != null && _skyOriginal.HasProperty(ExposureId))
            {
                _skyInstance = new Material(_skyOriginal) { name = _skyOriginal.name + " (time of day)" };
                RenderSettings.skybox = _skyInstance;
            }
            if (driveAmbient) RenderSettings.ambientMode = AmbientMode.Trilight;
        }

        private void OnDisable()
        {
            if (_skyInstance != null)
            {
                RenderSettings.skybox = _skyOriginal;
                Destroy(_skyInstance);
                _skyInstance = null;
            }
        }

        private void Update()
        {
            CurrentUtc = NowUtc();
            CurrentSun = SolarPosition.Compute(CurrentUtc, latitude, longitude);
            CurrentState = DaylightModel.Evaluate(CurrentSun.ElevationDeg, Tuning());
            Apply(CurrentSun, CurrentState);
        }

        /// <summary>Jumps the manual clock (switches to Manual mode).</summary>
        public void SetManualTime(int year, int dayOfYear, float localHour)
        {
            clock = ClockMode.Manual;
            manualYear = year;
            manualDayOfYear = Mathf.Clamp(dayOfYear, 1, 366);
            manualLocalHour = Mathf.Repeat(localHour, 24f);
        }

        private DateTime NowUtc()
        {
            switch (clock)
            {
                case ClockMode.Manual:
                    return MaastrichtClock.LocalToUtc(manualYear, manualDayOfYear, manualLocalHour);
                case ClockMode.Accelerated:
                    double simSeconds = (Time.realtimeSinceStartup - _acceleratedStartRealtime) * (double)timeScale;
                    return _acceleratedStartUtc.AddSeconds(simSeconds);
                default:
                    return DateTime.UtcNow.AddHours(offsetHours);
            }
        }

        private DaylightTuning Tuning()
        {
            var k = DaylightTuning.Default;
            k.NightStartDeg = nightStartElevation;
            k.NightFullDeg = nightFullElevation;
            k.SunMaxIntensity = sunMaxIntensity;
            k.MoonIntensity = moonIntensity;
            k.HorizonKelvin = horizonKelvin;
            k.NoonKelvin = noonKelvin;
            k.DaySky = ToRgb(daySky); k.DayEquator = ToRgb(dayEquator); k.DayGround = ToRgb(dayGround);
            k.DuskSky = ToRgb(duskSky); k.DuskEquator = ToRgb(duskEquator);
            k.NightSky = ToRgb(nightSky); k.NightEquator = ToRgb(nightEquator); k.NightGround = ToRgb(nightGround);
            return k;
        }

        private void Apply(SunAngles a, DaylightState s)
        {
            BloxShaderGlobals.SetNight(s.Night);
            if (sun != null)
            {
                bool moon = a.ElevationDeg < DaylightModel.SwapElevationDeg;
                float elevation = moon ? moonElevation : Mathf.Max((float)a.ElevationDeg, minLightElevation);
                float azimuth = (float)a.AzimuthDeg + (moon ? 180f : 0f);
                // A light shines along its forward axis, i.e. away from the sun.
                sun.transform.rotation = Quaternion.Euler(elevation, azimuth + 180f, 0f);
                sun.intensity = moon ? s.MoonIntensity : s.SunIntensity;
                sun.colorTemperature = moon ? moonKelvin : s.SunKelvin;
                sun.color = Color.white;
                sun.enabled = sun.intensity > 0.001f;
            }
            if (driveAmbient)
            {
                RenderSettings.ambientSkyColor = ToColor(s.AmbientSky);
                RenderSettings.ambientEquatorColor = ToColor(s.AmbientEquator);
                RenderSettings.ambientGroundColor = ToColor(s.AmbientGround);
                RenderSettings.reflectionIntensity = s.ReflectionIntensity;
            }
            if (_skyInstance != null) _skyInstance.SetFloat(ExposureId, s.SkyExposure);
        }

        private static Rgb ToRgb(Color c) => new Rgb(c.r, c.g, c.b);
        private static Color ToColor(Rgb c) => new Color(c.R, c.G, c.B);
    }
}
