# Maastricht Blox

A brick-built miniature of the whole city of Maastricht, made from open data, that you can
explore and walk around in the browser.

**Play:** https://tadiwa-m.github.io/Maastricht_larper/ (desktop Chrome/Edge recommended; a
controller works too)

- **The real city in bricks.** 4.1 × 5.6 km from the station to Sint-Pietersberg: 22,355
  chunks, ~28,000 buildings, 8,050 rotated building "islands" so angled streets keep straight
  facades. Built from AHN elevation, 3D BAG buildings and OpenStreetMap.
- **Detailed old centre.** A facade grammar with custom pieces (windows, shopfronts, balconies,
  pediments, lamps) and a hand-built Stadhuis on the Markt.
- **Alive.** Arriva buses run the real published timetable (GTFS), with people, cyclists, cars,
  market days, boats on the Maas, and a day/night cycle with lit windows.
- **Playable.** Fly over it like a map, or drop in anywhere and walk in third person with an
  open-world camera (mouse, keyboard, gamepad or touch).
- **Made for the browser.** The world streams around the camera, with per-chunk LOD and baked far
  silhouettes so the whole city stays visible.

Built in one week (October 2026) as a solo project, with Claude Code as a pair programmer.

## How it works

```
open data (AHN, 3D BAG, OSM, GTFS)
  -> pipeline/   Python: fetch, voxelise to a 0.5 m stud grid, facade grammar, brick layout
  -> .bxc/.bxi   binary brick chunks and rotated islands (CONTRACT.md)
  -> viewer/     three.js: instanced bevelled bricks, streaming, LOD, life, player
  -> static site on GitHub Pages
```

`CONTRACT.md` and `contract/*.json` define the formats shared by every component (brick
catalogue, palette, rotation rules with shared test vectors). Architecture and guides:
[`docs/README.md`](docs/README.md). Plan and phases: `PLAN.md`. Decisions: `docs/DEVLOG.md`.

## Build it yourself

```bash
scripts/check.sh                                   # all tests: pipeline, proxy, C# (dotnet), viewer
cd pipeline
uv run blox --slice city fetch                     # AHN, 3D BAG, OSM (cached, resumable)
uv run blox --slice city fetch --only gtfs         # bus timetable
uv run blox --slice city build --out ../build/world_city   # ~2-3 h on a workstation
uv run blox --slice city life  --out ../build/world_city   # buses, walkways, streets, river
cd ..
scripts/site.sh build/world_city build/site_city --serve   # static site at http://localhost:8000/
scripts/publish.sh build/site_city                 # deploy to GitHub Pages (one fresh commit)
scripts/film.sh build/site_city                    # demo video + stills, frame by frame (build/film/)
```
Windows (PowerShell): `.\scripts\check.ps1`, `.\scripts\site.ps1`, `.\scripts\publish.ps1`, `.\scripts\film.ps1`. New
machine: `scripts/setup-workstation.ps1` (or `.sh`), then `docs/guide/00-workstation-setup.md`.
`--slice centre` builds the smaller 2 × 2 km old town; `samples/markt_v3` is a ready-made sample
(`scripts/site.sh samples/markt_v3 build/site_markt --serve`).

## Components
- `pipeline/`: AHN + 3D BAG + OSM -> voxelised brick chunks and islands; GTFS -> life data
- `viewer/`: the three.js game (streaming city, life, walk mode)
- `contract/`: palette, brick catalogue, brick models, shared test vectors
- `proxy/`: live-data server (GTFS-RT, weather, river level), for after launch
- `unity/`: a Unity 6 URP version (code written, parked until after the web launch)

## Licence and credits
Code: MIT (`LICENSE`). Data: © OpenStreetMap contributors (ODbL; the generated world files are
a derived database under the ODbL) · 3D BAG by TU Delft 3D geoinformation (CC BY 4.0) · AHN
(AHN.nl; AHN4 via PDOK CC0, AHN5/AHN6 CC BY 4.0) · OVapi (GTFS) · weather:
[Buienradar.nl](https://www.buienradar.nl) (non-commercial use) · water levels: Rijkswaterstaat.
Where 3D BAG was unavailable, buildings come from OSM footprints with AHN heights.

The brick style is original. Not affiliated with, endorsed or sponsored by the LEGO Group.
