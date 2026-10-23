#ifndef BLOX_EDGES_INCLUDED
#define BLOX_EDGES_INCLUDED

// ---------------------------------------------------------------------------------------
// Analytic brick edges: bevel normal, seam line and crevice occlusion from the mesher's
// face coordinates (Blox.Meshing BrickVertex):
//   UV0 = position on the face in metres from the face's min corner (along u, v)
//   UV1 = face size in metres along (u, v); 0 = that axis has no brick edge (round bricks, HLOD)
// The face axes are rebuilt from the flat face normal exactly as FaceEmitter.FaceAxes does.
// FaceEmitter works in object space; objects may be turned about +Y (islands, CONTRACT 5.1, and
// brick models), so horizontal faces take u from the object's +X axis in world space
// (objectXWS = its xz, from the vertex shader). Side faces need nothing: cross(up, n) turns
// with the object because the turn is about up. Unrotated chunks get objectXWS = (1, 0).
// ---------------------------------------------------------------------------------------

void BloxFaceAxes(float3 n, float2 objectXWS, out float3 u, out float3 v)
{
    if (abs(n.y) > 0.999)
    {
        u = float3(objectXWS.x, 0.0, objectXWS.y);   // object +X (local +i)
        v = float3(-objectXWS.y, 0.0, objectXWS.x);  // cross(u, up) = object +Z (local +j)
        return;
    }
    u = normalize(cross(float3(0.0, 1.0, 0.0), n));
    v = normalize(cross(n, u));
}

// Fraction of a pixel footprint [d - p/2, d + p/2] (metres, 1D) covered by the band [0, w].
// Box-filtered, so thin lines fade to their true average instead of aliasing.
float BloxBandCoverage(float d, float w, float p)
{
    float lo = max(0.0, d - 0.5 * p);
    float hi = min(w, d + 0.5 * p);
    return saturate((hi - lo) / max(p, 1e-6));
}

// World-space size of one pixel at this fragment (metres). Uses camera-relative positions
// for precision far from the origin.
float BloxPixelFootprint(float3 positionWS)
{
    float3 rel = positionWS - _WorldSpaceCameraPos.xyz;
    return max(max(length(ddx(rel)), length(ddy(rel))), 1e-5);
}

struct BloxEdgeParams
{
    float bevelM;       // bevel width (metres)
    float bevelStrength;// 0..1, max sine of the edge tilt
    float seamM;        // dark seam line width (metres)
    float seamDarkness; // 0..1
    float creviceM;     // crevice occlusion falloff (metres)
    float creviceAO;    // 0..1
};

struct BloxEdgeResult
{
    float3 normalWS;    // bent normal
    float  seam;        // 0..1 seam coverage
    float  occlusion;   // 1 = open, lower near edges
};

// Accumulates one face axis into the tilt offset and the seam / crevice terms.
void BloxEdgeAxis(float coord, float size, float3 axis, float pixelM, BloxEdgeParams prm,
                  inout float3 tilt, inout float seam, inout float crevice)
{
    if (size <= 0.0) return;
    float d = max(0.0, min(coord, size - coord));
    float side = coord < 0.5 * size ? -1.0 : 1.0;

    // Quarter-round fillet: sin(tilt) = 1 - d / bevel. Faded out once the bevel gets
    // narrower than ~1.5 px (fwidth-based LOD) so it never sparkles in the distance.
    float lodFade = saturate((prm.bevelM / pixelM - 0.75) / 1.25);
    float sinTilt = saturate(1.0 - d / prm.bevelM) * prm.bevelStrength * lodFade;
    tilt += axis * side * sinTilt;

    seam = max(seam, BloxBandCoverage(d, prm.seamM, pixelM));

    // Crevice: quadratic falloff, widened to at least one pixel and scaled by the
    // band's true width so its average stays right when it becomes sub-pixel.
    float w = max(prm.creviceM, pixelM);
    float c = 1.0 - saturate(d / w);
    crevice = max(crevice, c * c * saturate(prm.creviceM / pixelM));
}

BloxEdgeResult BloxEvaluateEdges(float3 faceNormalWS, float2 objectXWS, float2 uv0, float2 uv1, float pixelM, BloxEdgeParams prm)
{
    float3 u, v;
    BloxFaceAxes(faceNormalWS, objectXWS, u, v);
    float3 tilt = 0.0;
    float seam = 0.0, crevice = 0.0;
    BloxEdgeAxis(uv0.x, uv1.x, u, pixelM, prm, tilt, seam, crevice);
    BloxEdgeAxis(uv0.y, uv1.y, v, pixelM, prm, tilt, seam, crevice);

    float t2 = min(dot(tilt, tilt), 0.96);
    BloxEdgeResult r;
    r.normalWS = normalize(faceNormalWS * sqrt(1.0 - t2) + tilt);
    r.seam = seam * prm.seamDarkness;
    r.occlusion = 1.0 - crevice * prm.creviceAO;
    return r;
}

// Per-brick micro variation: a tiny normal tilt offset from the brick seed, so neighbouring
// bricks catch the light slightly differently (real moulded parts do). Add it to the
// bent normal and renormalise. Axes come from the flat face normal.
float3 BloxBrickTiltOffset(float3 faceNormalWS, float2 objectXWS, float seed01, float amount)
{
    float3 u, v;
    BloxFaceAxes(faceNormalWS, objectXWS, u, v);
    float2 h = BloxSeedHash2(seed01) - 0.5;
    return (u * h.x + v * h.y) * (2.0 * amount);
}

#endif // BLOX_EDGES_INCLUDED
