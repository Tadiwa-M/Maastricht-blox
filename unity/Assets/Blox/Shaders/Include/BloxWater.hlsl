#ifndef BLOX_WATER_INCLUDED
#define BLOX_WATER_INCLUDED

// Procedural water ripples (no textures): four directional waves with analytic slopes.
// direction (xy), wavelength (z, metres), relative amplitude (w)
static const float4 kBloxWaves[4] =
{
    float4( 0.81,  0.59, 3.10, 1.00),
    float4(-0.38,  0.92, 1.70, 0.70),
    float4( 0.97, -0.24, 0.95, 0.45),
    float4(-0.66, -0.75, 5.30, 0.80)
};

// Horizontal slope (d height / dx, d height / dz) at a world position.
float2 BloxWaveSlope(float2 xz, float t, float scale, float speed)
{
    float2 slope = 0.0;
    [unroll] for (int n = 0; n < 4; n++)
    {
        float4 w = kBloxWaves[n];
        float k = TWO_PI / (w.z * scale);
        float c = sqrt(9.81 / k) * speed;            // deep-water phase speed
        float phase = k * (dot(w.xy, xz) - c * t);
        float a = w.w / k * 0.08;                    // steepness-limited amplitude
        slope += w.xy * (a * k * cos(phase));
    }
    return slope;
}

float3 BloxWaterNormal(float3 baseNormalWS, float3 positionWS, float t, float scale, float speed, float strength, float pixelM)
{
    // Ripples fade out once a wavelength covers only a few pixels (avoids glitter far away).
    float fade = saturate((scale * 0.95 / pixelM - 4.0) / 8.0);
    float2 s = BloxWaveSlope(positionWS.xz, t, scale, speed) * strength * fade;
    return normalize(baseNormalWS + float3(-s.x, 0.0, -s.y));
}

#endif // BLOX_WATER_INCLUDED
