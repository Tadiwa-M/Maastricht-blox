# Maastricht Blox

A brick-built, live miniature of Maastricht for PC (Unity 6 URP). Real terrain, buildings,
roads and the Maas; live buses, weather, time of day and river level.

See `CONTRACT.md` for the data formats and APIs shared by all components.

## Components
- `pipeline/`: AHN + 3D BAG + OSM → voxelised brick chunks (`build/world/`)
- `proxy/`: local live-data server (OVapi GTFS-RT, Buienradar, Rijkswaterstaat)
- `unity/`: the game

## Credits
Data © OpenStreetMap contributors (ODbL) · 3D BAG by TU Delft 3D geoinformation (CC BY 4.0) ·
AHN via PDOK · OVapi · Buienradar · Rijkswaterstaat.

Not affiliated with, endorsed or sponsored by the LEGO Group.
