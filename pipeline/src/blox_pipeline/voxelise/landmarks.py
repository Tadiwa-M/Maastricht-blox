"""Hand-curated overrides for well-known Maastricht buildings and zones.

A landmark is matched to a 3D BAG building when an OSM object whose ``name`` contains
one of ``names`` overlaps the footprint by >= 30 %, or when ``point`` (RD) lies inside
the footprint. Points marked approximate are only a fallback for the name match.
"""

from __future__ import annotations

from dataclasses import dataclass

from shapely.geometry import Polygon, box


@dataclass(frozen=True)
class Accent:
    """Recolour the part of a building within ``radius_m`` of ``centre`` (RD)."""

    centre: tuple[float, float]
    radius_m: float
    wall: str
    roof: str


@dataclass(frozen=True)
class Landmark:
    key: str
    display_name: str
    names: tuple[str, ...]
    point: tuple[float, float] | None
    wall: str
    roof: str
    windows: bool = False
    accent: Accent | None = None
    tags: tuple[tuple[str, str], ...] = ()


LANDMARKS: tuple[Landmark, ...] = (
    Landmark(
        key="sint_janskerk", display_name="Sint-Janskerk",
        names=("Sint-Janskerk", "Sint Janskerk", "Sint-Janstoren"),
        point=(176115.0, 317672.0),  # Sint-Janstoren (CONTRACT reference point)
        wall="mergel", roof="slate",
        accent=Accent(centre=(176115.0, 317672.0), radius_m=6.5, wall="tower_red", roof="tower_red"),
    ),
    Landmark(
        key="sint_servaas", display_name="Sint-Servaasbasiliek",
        names=("Sint-Servaasbasiliek", "Sint Servaasbasiliek", "Basiliek van Sint Servaas", "Basiliek van Sint-Servaas"),
        point=None, wall="mergel", roof="slate",
    ),
    Landmark(
        key="olv_basiliek", display_name="Onze-Lieve-Vrouwebasiliek",
        names=("Onze-Lieve-Vrouwebasiliek", "Onze Lieve Vrouwebasiliek", "Basiliek van Onze-Lieve-Vrouw"),
        point=None, wall="mergel", roof="slate",
    ),
    Landmark(
        key="stadhuis", display_name="Stadhuis Maastricht", names=("Stadhuis",),
        point=(176430.0, 318007.0),  # Markt (CONTRACT reference point); stadhuis stands on it
        wall="light_grey", roof="slate",
    ),
    Landmark(
        key="bonnefanten", display_name="Bonnefanten", names=("Bonnefanten",),
        point=(177040.0, 317098.0), wall="brick_red", roof="metal",
    ),
    Landmark(
        key="station", display_name="Station Maastricht", names=("Station Maastricht",),
        point=(177403.0, 317800.0), wall="brick_red", roof="slate", windows=True,
    ),
)

# Cobbled historic centre (Binnenstad west of the Maas, Wyck east of it). Approximate
# RD boxes; streets inside get cobble_grey unless OSM ``surface`` says otherwise.
CENTRE_ZONES: tuple[Polygon, ...] = (
    box(175900.0, 317350.0, 176680.0, 318250.0),
    box(176760.0, 317550.0, 177250.0, 317950.0),
)

# Names of water bodies that use the Maas level instead of a bank estimate.
MAAS_NAMES = ("Maas", "Meuse")
