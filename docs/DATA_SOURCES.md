# Data sources: verified endpoints, licences, gotchas

Verified on **2026-10-17**. Method: web search plus fetching public GitHub/PyPI pages that
quote or use the endpoints. **None of the data hosts below could be reached from the build
container**: the network policy blocks them, and a direct check returned HTTP 403 from the
proxy on CONNECT. So nothing here was confirmed by calling a live endpoint. Each claim gives
its evidence URL. Anything without solid evidence is marked **UNVERIFIED**. Before you rely
on an UNVERIFIED item, check it on the user's PC.

Legend: ✔ = confirmed by a primary or close-to-primary source (official page, the provider's
own repo, or code that calls it) · ~ = secondary source only · **UNVERIFIED** = no evidence found.

## Summary table

| Source | Use | Endpoint (base) | Auth | Licence / attribution | Status |
|---|---|---|---|---|---|
| AHN5 / AHN6 (heights) | terrain DTM + surface DSM | `https://basisdata.nl/hwh-ahn/AHN5/…` (GeoTIFF tiles); legacy AHN4 at `https://service.pdok.nl/rws/ahn/atom/…` | none | AHN6 (and the AHN dataroom): **CC BY 4.0**, "AHN.nl". PDOK AHN4: CC0 | ✔ / ~ |
| 3DBAG | buildings LoD1.2/1.3/2.2 | `https://data.3dbag.nl/latest/tile_index.fgb` → per-tile URLs | none | CC BY 4.0, "3DBAG by the 3D geoinformation group, TU Delft" | ✔ |
| OSM (Geofabrik) | roads, water, POIs, names | `https://download.geofabrik.de/europe/netherlands/limburg-latest.osm.pbf` (~95-100 MB) | none | ODbL, "© OpenStreetMap contributors" | ✔ |
| OVapi GTFS static | stops, shapes, routes | `https://gtfs.ovapi.nl/gtfs-nl.zip` (~239 MB zip / ~1.5 GB unzipped) | none | CC0 (per maintainer), "no SLA, don't impersonate agencies" | ✔ / ~ |
| OVapi GTFS-RT | bus vehicle positions, delays | `https://gtfs.ovapi.nl/nl/vehiclePositions.pb`, `tripUpdates.pb`, `alerts.pb`, `trainUpdates.pb` | none | as above | ✔ |
| NS API | train positions, departures | `https://gateway.apiportal.ns.nl/virtual-train-api/v1/…`, `…/reisinformatie-api/api/v2/departures` | **free key** (`Ocp-Apim-Subscription-Key`, product "Ns-App") | NS terms (beta, may change; no NS logo) | ~ |
| Buienradar | weather | `https://data.buienradar.nl/2.0/feed/json` | none | **non-commercial only**; credit Buienradar.nl **with a hyperlink to https://www.buienradar.nl** | ✔ |
| KNMI Data Platform | weather (alternative) | `https://api.dataplatform.knmi.nl/open-data/v1/datasets/10-minute-in-situ-meteorological-observations/versions/1.0/files` | API key (anonymous shared key, or a free registered key) | CC BY 4.0 (**UNVERIFIED**) | ✔ |
| Rijkswaterstaat WaterWebservices | Maas water level | `https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenLaatsteWaarnemingen` | none | open data (repo CC0; data licence **UNVERIFIED**) | ✔ (station code **UNVERIFIED**) |
| adsb.lol | aircraft | `https://api.adsb.lol/v2/point/{lat}/{lon}/{radius_nm}` | none today (a key is announced for "the future") | ODbL 1.0, "© adsb.lol contributors" | ✔ / ~ |
| PDOK Luchtfoto | colour sampling | `https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0` (layer `Actueel_orthoHR`, ~8 cm) | none | **CC BY**, credit "Beeldmateriaal Nederland" | ✔ |
| SNCB / De Lijn / TEC / DB | cross-border (later) | see section 12 | varies (registration) | varies | ~ |

---

## 1. AHN (Actueel Hoogtebestand Nederland)

**Status as of Oct 2026**
- AHN4 (survey 2020–2022) is fully published. PDOK serves it through ATOM feeds:
  `https://service.pdok.nl/rws/ahn/atom/dsm_05m.xml` and `…/dtm_05m.xml`, with WMS at
  `https://service.pdok.nl/rws/ahn/wms/v1_0`. Licence: **CC0**.
  Evidence: https://data.overheid.nl/dataset/36461-actueel-hoogtebestand-nederland-dsm--ahn4- (~)
- AHN5 survey ran 2023–2025. AHN6 survey runs 2025–2027. The first AHN6 part (north-east NL)
  was released in Oct 2025, under **CC BY 4.0** ("Creative Commons Naamsvermelding 4.0").
  Evidence: https://www.ahn.nl/eerste-deel-ahn-6-beschikbaar ,
  https://www.nationaalgeoregister.nl/geonetwork/srv/api/records/934a540d-25c5-4661-8c2c-2cc7f7c31541 (~)
- The mapterhorn source catalogue (Aug–Oct 2026) says that "both AHN5+AHN6 provide complete
  coverage for NL", with AHN5 covering mostly the west in 2026 and AHN6 the rest. It lists the
  licence as **CC BY 4.0, attribution "AHN.nl"**, with metadata at https://www.ahn.nl/dataroom.
  Evidence: https://github.com/mapterhorn/mapterhorn/pull/287 and
  https://raw.githubusercontent.com/mapterhorn/mapterhorn/36a4ccc/source-catalog/nl50cm/metadata.json (✔ code)
- **Which version covers Maastricht: UNVERIFIED.** Check the coverage index
  (`https://basisdata.nl/hwh-ahn/AUX/bladwijzer/index.html`; a GeoPackage `bladwijzer.gpkg` is
  also published) and take the newest version that covers RD bbox
  175700,316500 – 177748,318548.

**Download (current, AHN dataroom object storage)**
- URL pattern, taken from a working file list:
  `https://basisdata.nl/hwh-ahn/AHN5/02a_DTM_50cm/2024_M_69EZ1.TIF`
  (`{version}/{product}/{year}_M_{sheet}.TIF`). The DSM folder name is not visible in the
  evidence. Guess: `…/01a_DSM_50cm/` (**UNVERIFIED**).
  Evidence: https://raw.githubusercontent.com/mapterhorn/mapterhorn/36a4ccc/source-catalog/nl50cm/file_list_test.txt
- AHN5 tiles: 973 files of 5 × 6.25 km (named after map sheets). AHN6 tiles: **1 × 1 km**
  ("kilometerhokken"). The file list can be built from paged OGC API Features endpoints hosted
  on `api.ellipsis-drive.com` (v3). Follow `next` links. bbox is in EPSG:4326.
- The GRASS `r.in.ahn` add-on now reads AHN object storage directly. The old **WCS method is
  no longer supported**. Evidence: https://grass.osgeo.org/grass86/manuals/addons/r.in.ahn.html (~)

**DSM vs DTM**
- DTM = ground only. Buildings, vegetation and water are **NODATA**. DSM = top surface, with
  water NODATA. Fill NODATA before you voxelise the ground (e.g. `gdal_fillnodata`).
- The source CRS is **EPSG:7415** (RD + NAP compound). Treat it as EPSG:28992 for x/y.
  Evidence: mapterhorn nl50cm README (✔).

**Gotchas:** water is NODATA, so take the Maas surface from the RWS level or OSM polygons. A
5 × 6.25 km AHN5 sheet is several hundred MB at 0.5 m (size **UNVERIFIED**).

## 2. 3DBAG

- Latest release found: **v2025.09.03**. The release on 2025-09-09 added 3D Tiles and IFC
  output plus a ridge-height attribute. About 3 releases a year are made. **No 2026 release
  was found.** Check `latest`.
  Evidence: http://innovation.3dbag.nl/en/activities/ , https://3dbag.nl/en/download?tid=3312 (~)
- **Tile index:** `https://data.3dbag.nl/latest/tile_index.fgb` (FlatGeobuf, RD). Pinned
  version: `https://data.3dbag.nl/v20250903/tile_index.fgb`. Each feature has `tile_id`,
  `cj_download`, `obj_download`, `gpkg_download`.
  Evidence: https://github.com/3DBAG/3dbag-scripts/blob/main/tile_download.py (✔ code)
- Per-tile formats: **CityJSON** (LoD 1.2, 1.3 and 2.2 in one file), **OBJ** (one file per
  LoD), **GPKG**. The whole-country GPKG is a 19 GB zip (111 GB unzipped).
- Attributes: `b3_h_maaiveld` (ground height, m NAP) and `b3_h_nok` (ridge height) are
  confirmed (~). Roof percentiles such as `b3_h_dak_50p`, `b3_h_dak_70p` and `b3_h_dak_max`
  are **UNVERIFIED** for this release. GPKG layer names (`lod12_3d`, `lod13_3d`, `lod22_3d`,
  `pand`) are **UNVERIFIED**. Check them in `docs.3dbag.nl/en/schema/attributes/`.
  Evidence: https://data.source.coop/cholmes/portolan-nl/tudelft/3dbag/AGENTS.md (~)
- Licence **CC BY 4.0**. Attribution: 3D geoinformation research group, TU Delft (and 3DBAG).
  The pipeline code is Apache-2.0 / MIT.
- The download URLs include a version path. **Pin a version** in the pipeline and store it in
  `manifest.sources`.

## 3. OpenStreetMap (Geofabrik)

- Maastricht falls inside **`https://download.geofabrik.de/europe/netherlands/limburg-latest.osm.pbf`**
  (~95–100 MB, July 2026). The whole country (`netherlands-latest.osm.pbf`) is ~1.3 GB.
  Updated daily. `.md5` files sit next to each file.
  Evidence: https://download.geofabrik.de/europe/netherlands/limburg.html (✔ via search snapshot)
- Licence ODbL 1.0: "© OpenStreetMap contributors".
- Gotcha: the province polygon follows the national border, but the slice is all inside NL
  (**UNVERIFIED**: check the western edge near x=175700). Clip with `osmium extract -b`.

## 4. OVapi GTFS static + GTFS-Realtime

- Static: `https://gtfs.ovapi.nl/gtfs-nl.zip`: ~239 MB zipped, ~1,485 MB unzipped
  (Mobility Database, 2026-10-14). It changes every few days. The transitland validator timed
  out at 300 s, so use long timeouts and conditional GET (`If-Modified-Since`/ETag
  **UNVERIFIED**).
- Realtime (protobuf):
  - `https://gtfs.ovapi.nl/nl/vehiclePositions.pb` (~0.45–0.65 MB, ~1,000+ entities)
  - `https://gtfs.ovapi.nl/nl/tripUpdates.pb`
  - `https://gtfs.ovapi.nl/nl/alerts.pb`
  - `https://gtfs.ovapi.nl/nl/trainUpdates.pb` (trains: trip updates only, **no positions**)
  Evidence: https://github.com/transitland/transitland-atlas/blob/main/feeds/gtfs.ovapi.nl.dmfr.json (✔)
- Decoding needs the standard `gtfs-realtime.proto` **plus `gtfs-realtime-OVapi.proto`**
  (OVapi extensions). Evidence: https://github.com/laidig/gtfs-rt-autodoc/blob/master/gtfs-realtime-OVapi.proto
- **KV6 semantics gotcha:** `currentStopSequence` with `IN_TRANSIT_TO` means the stop the
  vehicle **just left**, not the next stop. Positions are about **1 minute old** (reported by
  a third party). Evidence: https://github.com/transitland/transitland-atlas/pull/2221 (~)
- Licence: data CC0 according to the maintainer. The README says "free to use … no
  service-level agreement (best-effort) nor are you allowed to say you represent or
  impersonate any of the transit agencies". README URL: `https://gtfs.ovapi.nl/README`.
  Evidence: https://community.openstreetmap.org/t/gtfs-in-nederland/105300 (~)
- **User-Agent requirement: UNVERIFIED.** No documentation found. Send a descriptive UA
  anyway (`MaastrichtBlox/0.1 (+contact)`). Poll no faster than every 15–30 s (the feed
  refreshes about once a minute; no official limit found).
- **Arriva Limburg buses in Maastricht: UNVERIFIED** (likely: the NL national KV6 aggregate
  includes Arriva, agency `ARR`). To verify on the PC, decode `vehiclePositions.pb` and count
  vehicles inside the slice bbox.

## 5. NS API (trains)

- Portal: `https://apiportal.ns.nl/`. Subscribe to the free product **"Ns-App"**, which
  gives a primary and a secondary key. Send the key in the `Ocp-Apim-Subscription-Key` header.
  Evidence: https://apiportal.ns.nl/startersguide , https://github.com/ultimatelemon/perron (~)
- Train positions: **Virtual Train API**, `GET https://gateway.apiportal.ns.nl/virtual-train-api/v1/vehicle`.
  Returns ~190 trains with lat/lon, speed (km/h) and direction. The spec lists both `/v1/…`
  and `/api/v1/…`, but **only `/v1/…` answers** (reported by a third party). Full host+path
  **UNVERIFIED**.
- Departures: `GET https://gateway.apiportal.ns.nl/reisinformatie-api/api/v2/departures?station=MT` (~).
  The Maastricht station code `MT` is **UNVERIFIED**.
- Rate limit: **300 requests / 5 min** per key (perron README, 2026). Older figures say
  50,000/day. Respect `Retry-After` on 429. Terms: beta service that can change; NS logo not
  allowed. https://www.ns.nl/en/travel-information/ns-api/conditions-for-use-ns-api.html
- Gotcha: whether Arriva's Limburg trains (Maastricht–Heerlen/Roermond) appear in the Virtual
  Train API is **UNVERIFIED**. The OVapi `trainUpdates.pb` covers delays only.

## 6. Buienradar

- JSON feed: `https://data.buienradar.nl/2.0/feed/json`. Rain nowcast:
  `https://gps.buienradar.nl/getrr.php?lat={lat:.2f}&lon={lon:.2f}` (text `iii|HH:MM` lines).
  Evidence: https://raw.githubusercontent.com/mjj4791/python-buienradar/master/buienradar/urls.py (✔ code)
- Fields in `actual.stationmeasurements[]` (✔ code): `stationid`, `stationname`, `lat`, `lon`,
  `timestamp` (local Europe/Amsterdam, `%Y-%m-%dT%H:%M:%S`, **no offset**), `temperature`,
  `feeltemperature`, `groundtemperature`, `humidity`, `airpressure`, `visibility`,
  `windspeed` (m/s), `windspeedBft`, `winddirection`, `winddirectiondegrees`, `windgusts`,
  `precipitation`, `rainFallLastHour`, `rainFallLast24Hour`, `sunpower`,
  `weatherdescription`, `iconurl`. Forecast: `forecast.fivedayforecast`.
  `actual.sunrise` / `actual.sunset`: **UNVERIFIED** (likely present).
  Maastricht station: "Meetstation Maastricht", id **6380**: **UNVERIFIED**. Pick the nearest
  station by lat/lon instead, as the python library does.
- **No cloud-cover percentage** field was found in the parsed set. `cloudPct` has to be
  estimated from `weatherdescription`/`iconurl`, or taken from KNMI.
- **Terms:** free use limited to **non-commercial** purposes. **Attribution is mandatory:
  credit Buienradar.nl with a hyperlink to https://www.buienradar.nl**. Mobile apps and
  commercial use need permission. Evidence: https://www.buienradar.nl/overbuienradar/gratis-weerdata ,
  https://www.buienradar.nl/overbuienradar/disclaimer (✔ via search; the page snapshot may be old)
- Rate limit: none published (**UNVERIFIED**). Polling every 10 min is plenty: stations
  update every 10 min.

## 7. KNMI Data Platform (weather alternative)

- Open Data API: `https://api.dataplatform.knmi.nl/open-data/v1/datasets/10-minute-in-situ-meteorological-observations/versions/1.0/files`
  (list) → `…/files/{filename}/url` (temporary download URL). The files are NetCDF.
  Header `Authorization: <key>`.
  Evidence: https://developer.dataplatform.knmi.nl/open-data-api ,
  https://dataplatform.knmi.nl/dataset/access/10-minute-in-situ-meteorological-observations-1-0 (✔)
- Keys: a shared **anonymous key** that **rotates yearly** (the current one is valid until
  2027-08-01; the old one expired 2026-08-01). Limits for it: 50 req/min shared, 3000 req/h.
  A free **registered key** does not expire and has its own quota. Use a registered key.
  Evidence: https://developer.dataplatform.knmi.nl/news (✔)
- The dataset `Actuele10mindataKNMIstations/2` is **deprecated**. Use
  `10-minute-in-situ-meteorological-observations/1.0`. It includes cloud cover, which
  Buienradar lacks. An EDR API also exists: https://developer.dataplatform.knmi.nl/edr-api
- Nearest station: Maastricht-Aachen Airport (WMO 06380): **UNVERIFIED**.

## 8. Rijkswaterstaat WaterWebservices (Maas level)

- **Migrated.** The classic `waterwebservices.rijkswaterstaat.nl/…_DBO/` services were
  unstable from 2026-03-09 and returned 503 from 2026-03-17, with a migration deadline of end
  of April 2026.
  Evidence: https://github.com/Rijkswaterstaat/WaterWebservices/discussions/46 (✔)
- New ("DDAPI20") endpoints, all `POST` with a JSON body and no auth:
  - `https://ddapi20-waterwebservices.rijkswaterstaat.nl/METADATASERVICES/OphalenCatalogus`
  - `https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen`
  - `https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenLaatsteWaarnemingen`
  - `…/ONLINEWAARNEMINGENSERVICES/CheckWaarnemingenAanwezig`
  Evidence: https://github.com/Rijkswaterstaat/WaterWebservices/discussions/43 (OphalenWaarnemingen path ✔),
  https://github.com/Deltares/ddlpy/blob/main/HISTORY.rst (ddlpy 0.8.0, 2025-12-13: "updated to new waterwebservices (ddapi20-…)") ✔.
  The other paths are inferred from the same service family (~).
- Latest-value request body (ddlpy `measurements_latest`, ✔ code):
  ```json
  {"AquoPlusWaarnemingMetadataLijst": [{"AquoMetadata": {"Compartiment": {"Code": "OW"}, "Grootheid": {"Code": "WATHTE"}}}],
   "LocatieLijst": [{"Code": "<fenomeenlocatiecode>"}]}
  ```
  WATHTE is in **cm NAP** (convert to m). HTTP **204** = no data. Use the exact datetime
  format `2026-10-17T12:00:00.000+01:00`. Other formats give 500 (issue #19).
- **Location codes changed.** They are now lowercase dotted "fenomeenlocatiecodes" with no
  X/Y, e.g. `lobith.bovenrijn.tolkamer`, `hoekvanholland`. The old→new mapping is in
  `https://rijkswaterstaatdata.nl/publish/pages/222873/fenomeen-naar-donar-lmw-mapping-v1_3.xlsx`.
  **The code for Maastricht Sint Pieter (official name "Sint Pieter Noord", Maas km 10.8) or
  Borgharen is UNVERIFIED.** A search snippet suggested `maastricht.borgharen.maas.beneden`
  (display name "Borgharen Dorp"), also UNVERIFIED. Note: Borgharen dorp is no longer used as a
  reference gauge since 2009–2010. To resolve it on the PC: call `OphalenCatalogus` (or
  `ddlpy.locations()`), filter `Naam` on "Pieter"/"Borgharen" with `Grootheid.Code == WATHTE`,
  then put the code in config, not code. The WFS listing
  `https://geo.rijkswaterstaat.nl/services/ogc/hws/DDAPI20/ows?SERVICE=WFS&VERSION=1.1.0&REQUEST=GetFeature&TYPENAME=locatiesmetlaatstewaarneming&outputFormat=csv`
  also lists codes.
- Gotchas: `OphalenLaatsteWaarnemingen` can lag 1–2 readings (discussion #57). Some locations
  return ancient "latest" values (discussion #47), so check the timestamp. Rate limit:
  **UNVERIFIED**. Poll every 10 min (readings are every 10 min).

## 9. adsb.lol (aircraft)

- `GET https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}`, radius in **nautical miles**.
  Aircraft are in `.ac[]`, with fields such as `hex`, `flight`, `lat`, `lon`, `alt_baro`,
  `gs`, `track`. Docs: https://api.adsb.lol/docs (not fetchable here). A third-party app uses
  radius 250 (max **UNVERIFIED**).
  Evidence: https://github.com/tedivm/skysnoop , https://github.com/adsblol/website/issues/279 (~)
- No key needed today. "In the future, you will require an API key", obtained by feeding
  adsb.lol. Rate limits are "dynamic based on the environment load". Poll ≤ 4/min.
  Evidence: https://github.com/adsblol/api (✔)
- Licence: **ODbL 1.0**, "© adsb.lol contributors". https://www.adsb.lol/docs/open-data/api/ (~)

## 10. PDOK Luchtfoto (aerial imagery for colour sampling)

- WMTS: `https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0?request=GetCapabilities&service=wmts`.
  Layers `Actueel_orthoHR` (~8 cm, latest year: **2026** HR is published) and
  `Actueel_ortho25` (25 cm). Tile matrix sets: `EPSG:28992` (and probably `EPSG:3857`,
  **UNVERIFIED**). WMS: `https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0`.
  Evidence: https://www.pdok.nl/-/hoge-resolutie-luchtfoto-2026-nu-beschikbaar-bij-pdok (✔ via search)
- Licence **CC BY**. Credit the "Samenwerkingsverband Beeldmateriaal" (Beeldmateriaal
  Nederland) and the licence. No key needed.

## 11. Network allowlist (hostnames to allow for the cloud environment)

```
basisdata.nl                     # AHN5/AHN6 GeoTIFF tiles + bladwijzer index
api.ellipsis-drive.com           # AHN OGC API Features file lists (optional)
www.ahn.nl                       # AHN docs / dataroom
service.pdok.nl                  # AHN4 ATOM/WMS, luchtfoto WMTS/WMS
api.pdok.nl                      # PDOK OGC APIs (optional, e.g. BAG/locatieserver)
data.3dbag.nl                    # 3DBAG tile index + tiles
3dbag.nl  docs.3dbag.nl  api.3dbag.nl   # docs / optional API
download.geofabrik.de            # OSM extracts
gtfs.ovapi.nl                    # GTFS static + GTFS-RT
gateway.apiportal.ns.nl          # NS APIs (needs key)
data.buienradar.nl  gps.buienradar.nl   # weather + rain nowcast
api.dataplatform.knmi.nl         # KNMI alternative (+ the signed download host it redirects to: UNVERIFIED)
ddapi20-waterwebservices.rijkswaterstaat.nl   # RWS water level
geo.rijkswaterstaat.nl           # RWS location WFS (optional)
rijkswaterstaatdata.nl           # RWS docs / code mapping xlsx
api.adsb.lol                     # aircraft
```

## 12. Cross-border (later, brief)

- **SNCB/NMBS**: static GTFS + GTFS-RT, free after registration/contract, through the Belgian
  Mobility portal https://data.belgianmobility.io/ .
  https://www.belgiantrain.be/nl/3rd-party-services/mobility-service-providers/public-data (~)
- **De Lijn**: GTFS-RT through the De Lijn API portal (https://data.delijn.be/, subscription
  key). Licence: Open Data Commons Attribution 1.0. Limits apply per subscription.
  https://transportdata.be/dataset/gtfs-realtime-v2 (~). Exact URL **UNVERIFIED**.
- **TEC**: static + realtime listed on the Belgian Mobility portal. RT URL **UNVERIFIED**.
- **DB / Germany**: static GTFS through gtfs.de. A free GTFS-RT
  (`realtime.gtfs.de/realtime-free.pb`) is **UNVERIFIED**.

## 13. Points that affect CONTRACT.md

1. **AHN licence**: §9 says "AHN / PDOK (CC0)". That holds for AHN4 on PDOK, but AHN6 (and,
   per mapterhorn, the AHN5/6 dataroom distribution) is **CC BY 4.0** and needs "AHN" credit.
2. **Missing attributions in §9**: PDOK luchtfoto (CC BY, Beeldmateriaal Nederland), adsb.lol
   (ODbL), and NS/KNMI if used. Buienradar's terms limit use to **non-commercial** purposes.
   Mobile and commercial releases need permission.
3. **§8 `/v1/weather.cloudPct`**: Buienradar has no cloud-percentage field. The proxy must
   derive it from the description or icon, or use KNMI.
4. **§8 `/v1/water`**: RWS moved to the DDAPI20 host with new location codes. The upstream code
   for "Maastricht Sint Pieter" still has to be resolved (see section 8). The display name in
   the contract is fine. Values arrive in cm NAP.
5. **§8 vehicle timing**: OVapi positions are about 60 s old, and KV6 stop semantics differ
   (section 4). Rendering at `now − 60 s` plus OVapi latency means vehicles show about 2 min
   behind reality. That is acceptable but worth knowing. Trains need the NS key. OVapi has no
   train positions.
