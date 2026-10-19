# Blox.Live

Client for the live proxy (CONTRACT section 8). Everything except `Unity/LiveClient.cs` is
engine-free and tested in `dotnet/`.

| Type | What |
|---|---|
| `LiveJson` | Parses `/v1/health`, `/v1/vehicles`, `/v1/shapes`, `/v1/stops`, `/v1/weather`, `/v1/water` into DTOs (`LiveDtos.cs`). |
| `ShapePolyline` | Shape points (world x, z, cumDistM), a thin wrapper over `Blox.Data.PathMover` (the same mover characters use): `Evaluate(dist) -> x, z, heading` (0 = north/+z, 90 = east/+x) or `PoseAt(dist)`, clamped. `TurnRadiusM` smooths corners (0 = raw segment heading). |
| `VehicleTrack` | Motion rule: render at now - 60 s, interpolate `distAlongShapeM` on the shape (fallback: lerp `world`), extrapolate along the shape with `speedMps` for at most 30 s (off-shape vehicles hold), never animate forward faster than 40 m/s (no teleport), snap backward jumps (flagged `Discontinuity`). Reported distance going back by <= 50 m is clamped; more, or a new `shapeId`, starts a new trip. |
| `VehiclePose` | Sampled state; `ToPose(groundY)` gives the shared `Blox.Data.Pose` (position + yaw clockwise from north) used to place any brick model. |
| `VehicleRegistry` | All tracks (`TurnRadiusM` is applied to every shape; `LiveClient` sets 6 m): `SetShapes`, `Apply(VehiclesDto)`, `Prune(now)` (drops vehicles unseen for 120 s), `SampleAll(now, dict)`, `Latest(id)` for labels. |
| `LiveClock` | Smoothed proxy-clock offset from response `ts`, so render time follows the proxy. |
| `LiveClient` (MonoBehaviour) | Polls vehicles every 5 s, weather/water every 5 min, shapes/stops every 30 min, health every 30 s with `UnityWebRequest`. Use `SamplePoses()` once per frame. Exposes `Weather`, `Water`, `Stops`, `Health`, `LastError` and update events. |

Plain-HTTP to `127.0.0.1:8787` requires *Player Settings > Allow downloads over HTTP* (Unity 2022+).
