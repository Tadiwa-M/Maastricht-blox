# Maastricht Blox

A brick-built, live miniature of Maastricht for PC (Unity 6 URP). Real terrain, buildings,
roads and the Maas; live buses, weather, time of day and river level.

See `CONTRACT.md` for the data formats and APIs shared by all components.

## Quick start
```bash
scripts/check.sh            # all tests: pipeline, proxy, C# (dotnet), viewer
scripts/shots.sh            # rebuild the look-test scene and take viewer screenshots (build/shots/)
scripts/unity.sh all        # GPU workstation: Unity compile, tests, build, screenshot (Windows: scripts\unity.ps1)
```
New machine: `scripts/setup-workstation.ps1` (or `.sh`), then see `docs/guide/00-workstation-setup.md`.
Plan and phases: `PLAN.md` · how it works: [`docs/README.md`](docs/README.md) (architecture, guides, dev log) · interface formats: `CONTRACT.md`.

## Components
- `pipeline/`: AHN + 3D BAG + OSM → voxelised brick chunks (`build/world/`)
- `proxy/`: local live-data server (OVapi GTFS-RT, Buienradar, Rijkswaterstaat)
- `viewer/`: three.js browser viewer for fast look previews (no Unity needed)
- `unity/`: the game (C# under `unity/Assets/Blox/`; engine-free parts tested via `dotnet/`)
- `contract/`: palette, brick catalogue, brick models, shared test vectors

## Credits
Data © OpenStreetMap contributors (ODbL) · 3D BAG by TU Delft 3D geoinformation (CC BY 4.0) ·
AHN (AHN.nl; AHN4 via PDOK CC0, AHN5/AHN6 CC BY 4.0) · aerial photo: Beeldmateriaal Nederland
via PDOK (CC BY 4.0, only if used for ground colours) · OVapi (GTFS / GTFS-RT) ·
weather: [Buienradar.nl](https://www.buienradar.nl) (non-commercial use) · water levels: Rijkswaterstaat ·
train positions: NS (only if an NS API key is configured).

Status, what is verified and the next steps on a PC: `docs/STATUS.md`.

Not affiliated with, endorsed or sponsored by the LEGO Group.
