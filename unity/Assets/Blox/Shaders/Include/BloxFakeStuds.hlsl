#ifndef BLOX_FAKE_STUDS_INCLUDED
#define BLOX_FAKE_STUDS_INCLUDED

// ---------------------------------------------------------------------------------------
// Studs that are not drawn as geometry (beyond the StudRenderer's mid LOD) are faked on
// flat top faces: a bevelled rim normal, a contact-occlusion ring and a short sun-side
// shadow. A face only gets them where _BloxStudTops says an exposed stud sits at exactly
// this level, so tiles (roads), covered faces and HLOD boxes stay smooth.
// The contact ring is applied at every distance (it also grounds the real studs).
// ---------------------------------------------------------------------------------------

struct BloxStudParams
{
    float strength;   // 0..1 overall
    float ringAO;     // contact ring occlusion 0..1
    float shadow;     // fake sun shadow strength 0..1
};

// Distance from p to the segment [0, b].
float BloxSegmentDistance(float2 p, float2 b)
{
    float t = saturate(dot(p, b) / max(dot(b, b), 1e-6));
    return length(p - b * t);
}

// Modifies normal, occlusion and an albedo shade factor in place.
void BloxApplyFakeStud(float3 positionWS, float3 faceNormalWS, float camDist, float pixelM,
                       BloxStudParams prm, inout float3 normalWS, inout float occlusion, inout float shade)
{
    if (faceNormalWS.y < 0.99 || prm.strength <= 0.0) return;

    int I = (int)floor(positionWS.x / BLOX_STUD_M);
    int J = (int)floor(positionWS.z / BLOX_STUD_M);
    int K = (int)round(positionWS.y / BLOX_PLATE_M);
    if ((int)BloxStudTopAt(I, J) != K) return;

    const float R = BLOX_STUD_RADIUS_M;
    float2 local = positionWS.xz - (float2(I, J) + 0.5) * BLOX_STUD_M; // metres from stud centre
    float r = length(local);

    // Sub-pixel studs collapse to their area average (no shimmering).
    float aa = saturate(R / pixelM - 0.5);
    float far = smoothstep(_BloxStudFade.x, _BloxStudFade.y, camDist);

    // Contact ring just outside the stud base (all distances).
    const float ringW = 0.05;
    float ring = (r > R) ? 1.0 - saturate((r - R) / ringW) : 0.0;
    float ringAvg = 0.25;  // approx. ring area share of a cell, weighted
    occlusion *= 1.0 - prm.ringAO * prm.strength * lerp(ringAvg * 0.35, ring * ring, aa);

    if (far <= 0.0) return;

    // Bevelled rim: the normal tips outward over the last 0.025 m of the disc.
    const float rimW = 0.025;
    float rim = (r < R) ? saturate((r - (R - rimW)) / rimW) : 0.0;
    float2 outward = r > 1e-4 ? local / r : float2(0.0, 0.0);
    float tiltAmt = rim * 0.85 * aa * far * prm.strength;
    normalWS = normalize(normalWS + float3(outward.x, 0.0, outward.y) * tiltAmt);

    // Short shadow cast away from the sun (direction toward the main light).
    float3 L = _MainLightPosition.xyz;
    if (L.y > 0.05)
    {
        float lenM = min(BLOX_STUD_HEIGHT_M * length(L.xz) / L.y, 0.45);
        float2 dirXZ = -normalize(L.xz + 1e-5);
        float dS = BloxSegmentDistance(local, dirXZ * lenM);
        float inShadow = (r > R) ? 1.0 - smoothstep(R - 0.01, R + 0.01, dS) : 0.0;
        float avg = 0.12 * saturate(lenM / 0.2);
        float s = lerp(avg, inShadow, aa) * prm.shadow * far * prm.strength * (1.0 - _BloxNight);
        shade *= 1.0 - 0.5 * s;
    }
}

#endif // BLOX_FAKE_STUDS_INCLUDED
