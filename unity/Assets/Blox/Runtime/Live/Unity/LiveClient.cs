#nullable enable
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;

namespace Blox.Live
{
    /// <summary>
    /// Thin HTTP poller for the live proxy (CONTRACT section 8): vehicles every 5 s,
    /// weather/water every 5 min, shapes/stops at start and every 30 min, health every 30 s.
    /// All logic (parsing, motion rule) lives in the engine-free classes; this only does I/O.
    /// Note: plain-HTTP localhost needs Player Settings > "Allow downloads over HTTP".
    /// </summary>
    public sealed class LiveClient : MonoBehaviour
    {
        [SerializeField] private string baseUrl = "http://127.0.0.1:8787";
        [SerializeField] private float vehiclesIntervalSec = 5f;
        [SerializeField] private float environmentIntervalSec = 300f;
        [SerializeField] private float staticIntervalSec = 1800f;
        [SerializeField] private float healthIntervalSec = 30f;
        [SerializeField] private int timeoutSec = 10;
        [Tooltip("Corner smoothing for buses on their route shapes (m); same rule as path followers (Blox.Data.PathMover).")]
        [SerializeField, Min(0f)] private float busTurnRadiusM = 6f;

        public VehicleRegistry Registry { get; } = new VehicleRegistry();
        public LiveClock Clock { get; } = new LiveClock();
        public WeatherDto? Weather { get; private set; }
        public WaterDto? Water { get; private set; }
        public StopsDto? Stops { get; private set; }
        public HealthDto? Health { get; private set; }
        public string? LastError { get; private set; }

        public event Action<WeatherDto>? WeatherUpdated;
        public event Action<WaterDto>? WaterUpdated;
        public event Action<StopsDto>? StopsUpdated;
        public event Action<ShapesDto>? ShapesUpdated;
        public event Action<VehiclesDto>? VehiclesUpdated;

        private readonly Dictionary<string, VehiclePose> _poses = new Dictionary<string, VehiclePose>();

        /// <summary>Current proxy-clock time in Unix seconds.</summary>
        public double Now => Clock.Now(LiveClock.LocalUnixNow());

        /// <summary>
        /// Poses for this frame (render time = Now - 60 s). The dictionary is reused. Turn one into
        /// the shared <see cref="Blox.Data.Pose"/> with <see cref="VehiclePose.ToPose"/> and place the
        /// bus model with it, exactly like a path follower.
        /// </summary>
        public IReadOnlyDictionary<string, VehiclePose> SamplePoses()
        {
            Registry.SampleAll(Now, _poses);
            return _poses;
        }

        public string BaseUrl { get => baseUrl; set => baseUrl = value.TrimEnd('/'); }

        private void OnEnable()
        {
            Registry.TurnRadiusM = busTurnRadiusM;
            StartCoroutine(Loop(staticIntervalSec, PollStatic));
            StartCoroutine(Loop(vehiclesIntervalSec, PollVehicles));
            StartCoroutine(Loop(environmentIntervalSec, PollEnvironment));
            StartCoroutine(Loop(healthIntervalSec, PollHealth));
        }

        private void OnDisable() => StopAllCoroutines();

        private static IEnumerator Loop(float interval, Func<IEnumerator> body)
        {
            while (true)
            {
                yield return body();
                yield return new WaitForSecondsRealtime(interval);
            }
        }

        private IEnumerator PollStatic()
        {
            yield return Get("/v1/shapes", json =>
            {
                var shapes = LiveJson.ParseShapes(json);
                Registry.SetShapes(shapes);
                ShapesUpdated?.Invoke(shapes);
            });
            yield return Get("/v1/stops", json =>
            {
                Stops = LiveJson.ParseStops(json);
                StopsUpdated?.Invoke(Stops);
            });
        }

        private IEnumerator PollVehicles()
        {
            yield return Get("/v1/vehicles", json =>
            {
                var v = LiveJson.ParseVehicles(json);
                Clock.Observe(v.Ts, LiveClock.LocalUnixNow());
                Registry.Apply(v);
                Registry.Prune(Now);
                VehiclesUpdated?.Invoke(v);
            });
        }

        private IEnumerator PollEnvironment()
        {
            yield return Get("/v1/weather", json =>
            {
                Weather = LiveJson.ParseWeather(json);
                WeatherUpdated?.Invoke(Weather);
            });
            yield return Get("/v1/water", json =>
            {
                Water = LiveJson.ParseWater(json);
                WaterUpdated?.Invoke(Water);
            });
        }

        private IEnumerator PollHealth()
        {
            yield return Get("/v1/health", json => Health = LiveJson.ParseHealth(json));
        }

        private IEnumerator Get(string path, Action<string> onJson)
        {
            using var req = UnityWebRequest.Get(baseUrl.TrimEnd('/') + path);
            req.timeout = timeoutSec;
            yield return req.SendWebRequest();
            if (req.result != UnityWebRequest.Result.Success)
            {
                // 503 = proxy has no data for this source yet; keep the previous value.
                LastError = $"{path}: {req.responseCode} {req.error}";
                yield break;
            }
            try
            {
                onJson(req.downloadHandler.text);
                LastError = null;
            }
            catch (Exception e)
            {
                LastError = $"{path}: {e.Message}";
                Debug.LogWarning($"[Blox.Live] bad response from {path}: {e.Message}");
            }
        }
    }
}
