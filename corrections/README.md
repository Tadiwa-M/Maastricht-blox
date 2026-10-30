# Map corrections

Small, reviewable fixes to the source data, applied on every `blox build`
(`pipeline/src/blox_pipeline/sources/corrections.py`). Most "Report a mistake" issues are fixed by
adding one entry here, not by changing code. Coordinates are **RD (EPSG:28992) metres**: every
report lists them, together with a link that opens the spot in the game.

```json
{ "version": 1, "fixes": [
  { "id": "station-kiosk", "issue": 12, "note": "kiosk demolished in 2024",
    "kind": "remove_building", "at": [177420.5, 317790.0] },
  { "id": "vrijthof-height", "issue": 15, "note": "3D BAG roof too low",
    "kind": "set_height", "bag": "NL.IMBAG.Pand.0935100000012345", "height_m": 14.5 },
  { "id": "new-pavilion", "issue": 18, "note": "missing in BAG",
    "kind": "add_building", "polygon": [[176400, 318000], [176410, 318000], [176410, 318008], [176400, 318008]],
    "height_m": 6, "roof": "gable", "eave_m": 4 },
  { "id": "wilhelminabrug", "issue": 20, "note": "deck is a bridge",
    "kind": "osm_tags", "osm": "way/12345678", "set": { "bridge": "yes", "layer": "1" } }
] }
```

| kind | selects | does |
|---|---|---|
| `remove_building` | `bag` (BAG id, or `osm-way/<id>` for OSM-based houses) or `at: [x, y]` | drops the building |
| `set_height` | same, plus `height_m` | roof top `height_m` above the ground |
| `add_building` | `polygon` (3+ RD points), `height_m`, `roof` flat/gable, `eave_m` | adds a building on the AHN ground |
| `osm_tags` | `osm: "way/<id>"`, `set`, `remove` | edits an OSM object's tags before voxelising |

Always add `issue` and a short `note`. A fix that matches nothing is logged at build time
("corrections: N applied, M matched nothing (...)") so stale fixes are easy to spot.
Fixes take effect on the next city build (`blox --slice city build`).
