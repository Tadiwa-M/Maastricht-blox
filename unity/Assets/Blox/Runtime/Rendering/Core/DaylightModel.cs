using System;

namespace Blox.Rendering
{
    /// <summary>Linear RGB triple (engine-free).</summary>
    public readonly struct Rgb
    {
        public readonly float R, G, B;
        public Rgb(float r, float g, float b) { R = r; G = g; B = b; }
        public static Rgb Lerp(Rgb a, Rgb b, float t) => new Rgb(a.R + (b.R - a.R) * t, a.G + (b.G - a.G) * t, a.B + (b.B - a.B) * t);
        public Rgb Scale(float s) => new Rgb(R * s, G * s, B * s);
        public override string ToString() => $"({R:0.###}, {G:0.###}, {B:0.###})";
    }

    /// <summary>Lighting state for one sun elevation.</summary>
    public struct DaylightState
    {
        public float Night;               // 0 day .. 1 night (_BloxNight)
        public float SunIntensity;        // directional light intensity (sun, 0 at night)
        public float SunKelvin;           // colour temperature of the sun
        public float MoonIntensity;       // directional light intensity at night
        public Rgb AmbientSky, AmbientEquator, AmbientGround;
        public float ReflectionIntensity; // RenderSettings.reflectionIntensity
        public float SkyExposure;         // procedural skybox _Exposure
    }

    /// <summary>
    /// Maps sun elevation to light and ambient values. Hand-tuned curves for a warm,
    /// toy-like look; every constant is a public field of <see cref="DaylightTuning"/>.
    /// </summary>
    public static class DaylightModel
    {
        /// <summary>Elevation (deg) below which the directional light represents the moon.</summary>
        public const float SwapElevationDeg = -1.5f;

        public static DaylightState Evaluate(double elevationDeg, in DaylightTuning k)
        {
            float e = (float)elevationDeg;
            var s = new DaylightState
            {
                Night = SmoothStep(k.NightStartDeg, k.NightFullDeg, e),
                SunIntensity = k.SunMaxIntensity * SmoothStep(SwapElevationDeg, 14f, e),
                SunKelvin = SunKelvin(e, k),
            };
            // Sun fades to 0 at -1.5 deg and the moon starts from 0 there, so the controller can
            // swap the light's direction at that elevation without a visible jump.
            s.MoonIntensity = k.MoonIntensity * SmoothStep(SwapElevationDeg, -8f, e);

            // 0 = deep night, 1 = golden hour, 2 = full day (piecewise blend of three palettes).
            float day = SmoothStep(-2f, 25f, e);
            float dusk = SmoothStep(-8f, 0f, e) * (1f - SmoothStep(4f, 20f, e));
            Rgb sky = Rgb.Lerp(k.NightSky, k.DaySky, day);
            Rgb eq = Rgb.Lerp(k.NightEquator, k.DayEquator, day);
            Rgb gr = Rgb.Lerp(k.NightGround, k.DayGround, day);
            s.AmbientSky = Rgb.Lerp(sky, k.DuskSky, dusk * 0.6f);
            s.AmbientEquator = Rgb.Lerp(eq, k.DuskEquator, dusk * 0.7f);
            s.AmbientGround = gr;
            s.ReflectionIntensity = 0.25f + 0.75f * day;
            s.SkyExposure = 0.15f + 1.15f * SmoothStep(-6f, 10f, e);
            return s;
        }

        /// <summary>Sun colour temperature: ~1900 K at the horizon to ~5900 K high in the sky.</summary>
        public static float SunKelvin(float elevationDeg, in DaylightTuning k)
        {
            float t = 1f - (float)Math.Exp(-Math.Max(0f, elevationDeg) / k.KelvinRiseDeg);
            return k.HorizonKelvin + (k.NoonKelvin - k.HorizonKelvin) * t;
        }

        public static float SmoothStep(float edge0, float edge1, float x)
        {
            float t = (x - edge0) / (edge1 - edge0);
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            return t * t * (3f - 2f * t);
        }
    }

    /// <summary>Tuning constants for <see cref="DaylightModel"/> (TimeOfDayController exposes them in the inspector).</summary>
    public struct DaylightTuning
    {
        public float NightStartDeg;   // _BloxNight starts rising below this elevation
        public float NightFullDeg;    // and is 1 below this one
        public float SunMaxIntensity;
        public float MoonIntensity;
        public float HorizonKelvin;
        public float NoonKelvin;
        public float KelvinRiseDeg;
        public Rgb DaySky, DayEquator, DayGround;
        public Rgb DuskSky, DuskEquator;
        public Rgb NightSky, NightEquator, NightGround;

        public static DaylightTuning Default => new DaylightTuning
        {
            NightStartDeg = 4f,
            NightFullDeg = -6f,
            SunMaxIntensity = 2.2f,
            MoonIntensity = 0.12f,
            HorizonKelvin = 1900f,
            NoonKelvin = 5900f,
            KelvinRiseDeg = 14f,
            DaySky = new Rgb(0.52f, 0.62f, 0.78f),
            DayEquator = new Rgb(0.46f, 0.47f, 0.47f),
            DayGround = new Rgb(0.24f, 0.22f, 0.19f),
            DuskSky = new Rgb(0.42f, 0.36f, 0.42f),
            DuskEquator = new Rgb(0.62f, 0.40f, 0.28f),
            NightSky = new Rgb(0.035f, 0.05f, 0.09f),
            NightEquator = new Rgb(0.03f, 0.035f, 0.05f),
            NightGround = new Rgb(0.015f, 0.015f, 0.02f),
        };
    }
}
