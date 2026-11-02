"""BGT polygons -> ground surface patches and water bodies (accuracy phase A1).

Inside the area the BGT cache covers (``BgtData.extent``) the ground comes from the BGT's
level-0 polygons, which tile the city's surface exactly: carriageways, footways, cycle paths,
parking, verges, green and water. OSM patches there keep only their feature ids (street and
park names for picking) and bridge decks; outside the extent everything stays OSM.

Paint order (priority, low to high): OSM landuse 10, OSM squares 20, OSM roads 30-39 (feature
ids only inside the extent), BGT terrain/green 40, footways 41, cycle paths 42, kerbs 43,
carriageways 44, OSM rails 50, island paving 60. BGT polygons do not overlap at one level,
so the order only matters for kerbs (a 0.6 m strip just outside every carriageway, drawn under
the carriageway parts next to it).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from shapely import STRtree
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from ..sources.model import BgtData, BgtFeature, HeightGrid, OsmData
from . import palette
from .features import FeatureRegistry
from .grid import FULL, TILE
from .prepare_osm import KERB_COLOUR, KERB_M, bank_level, in_centre, is_maas
from .world import SurfacePatch, VoxelConfig, WaterBody

log = logging.getLogger(__name__)

P_TERRAIN, P_FOOT, P_CYCLE, P_KERB_BGT, P_CARRIAGEWAY = 40.0, 41.0, 42.0, 43.0, 44.0

# wegdeel functie -> class
CARRIAGEWAY = frozenset({
    "rijbaan lokale weg", "rijbaan regionale weg", "rijbaan autoweg", "rijbaan autosnelweg",
    "OV-baan", "verbindingsweg", "calamiteitendoorsteek", "overweg", "spoorbaan",
    "baan voor vliegverkeer",
})
KERBED = frozenset({  # carriageways that get a kerb (not parking, driveways or level crossings)
    "rijbaan lokale weg", "rijbaan regionale weg", "rijbaan autoweg", "rijbaan autosnelweg", "OV-baan",
})
# carriageways of decorative setts are shared, flush surfaces (the Markt): no kerb lines
FLUSH = frozenset({"sierbestrating"})
PARKING = frozenset({"parkeervlak", "inrit", "verkeersdrempel"})  # at carriageway level
FOOTWAY = frozenset({"voetpad", "voetgangersgebied", "voetpad op trap", "woonerf", "ruiterpad"})
CYCLEWAY = frozenset({"fietspad"})

# plus_fysiek_voorkomen (the material) -> colour
MATERIAL_COLOUR = {
    "asfalt": "asphalt", "tegels": "pavement", "betonstraatstenen": "cobble_grey",
    "sierbestrating": "cobble_grey", "gebakken klinkers": "brick_brown", "beton element": "light_grey",
    "cementbeton": "light_grey", "gravel": "tan", "grind": "tan", "schelpen": "tan", "zand": "tan",
    "grasklinkers": "grass_dark", "kunststof": "grass_dark", "boomschors": "soil",
    "puin": "dark_tan", "kunstgras": "grass_dark",
}
# fysiek_voorkomen (coarse surface) -> colour, when the material is unknown
SURFACE_COLOUR = {
    "gesloten verharding": "asphalt", "open verharding": "pavement", "half verhard": "dark_tan",
    "onverhard": "soil", "zand": "tan", "groenvoorziening": "grass", "grasland overig": "grass",
    "grasland agrarisch": "grass", "struiken": "grass_dark", "loofbos": "grass_dark",
    "naaldbos": "grass_dark", "gemengd bos": "grass_dark", "houtwal": "grass_dark",
    "bouwland": "dark_tan", "fruitteelt": "grass_dark", "boomteelt": "grass_dark", "rietland": "grass_dark",
    "moeras": "grass_dark", "heide": "grass_dark", "kwelder": "grass", "duin": "tan",
}
PAVED = frozenset({"gesloten verharding", "open verharding"})
SHALLOW_WATER = frozenset({"greppel, droge sloot"})


@dataclass(frozen=True)
class GroundClass:
    priority: float
    shape: int
    colour: str


def classify(f: BgtFeature, centre: bool = False) -> GroundClass | None:
    """How a level-0 BGT object paints the ground; None = leave it (yards, water, unknown).

    ``centre``: in the old centre (look v2) setts and pavers are the dark wet cobbles."""
    p = f.props
    surface, material = p.get("fysiek_voorkomen"), p.get("plus_fysiek_voorkomen")
    colour = MATERIAL_COLOUR.get(material or "") or SURFACE_COLOUR.get(surface or "")
    if centre and colour in ("cobble_grey", "brick_brown") and material in ("sierbestrating", "gebakken klinkers"):
        colour = "cobble_dark"
    if f.layer == "wegdeel":
        fn = p.get("functie", "")
        if fn in CYCLEWAY:
            # Dutch cycle paths are red asphalt (or red pavers)
            red = colour in (None, "asphalt", "brick_brown")
            return GroundClass(P_CYCLE, TILE, "brick_dark_red" if red else colour)
        if fn in CARRIAGEWAY or fn in PARKING:
            if fn == "spoorbaan":
                return GroundClass(P_CARRIAGEWAY, TILE, "rail_brown")
            return GroundClass(P_CARRIAGEWAY, TILE, colour or "asphalt")
        if fn in FOOTWAY:
            if fn == "voetpad op trap":
                return GroundClass(P_FOOT, TILE, "light_grey")
            return GroundClass(P_FOOT, TILE, colour or "pavement")
        return GroundClass(P_FOOT, TILE, colour or "pavement")
    if f.layer == "ondersteunendwegdeel":  # verges and traffic islands
        paved = surface in PAVED or surface == "half verhard"
        return GroundClass(P_FOOT if paved else P_TERRAIN, TILE if paved else FULL, colour or "grass")
    if f.layer == "begroeidterreindeel":
        return GroundClass(P_TERRAIN, FULL, colour or "grass")
    if f.layer == "onbegroeidterreindeel":
        if surface == "erf":
            return None  # yards: private, mixed; the aerial photo colour (or grass) stays
        paved = surface in PAVED
        return GroundClass(P_TERRAIN, TILE if paved else FULL, colour or "dark_tan")
    if f.layer == "ondersteunendwaterdeel":  # banks
        return GroundClass(P_TERRAIN, FULL, "grass")
    return None


GROUND_LAYERS = ("wegdeel", "ondersteunendwegdeel", "begroeidterreindeel", "onbegroeidterreindeel",
                 "ondersteunendwaterdeel")


def ground_features(bgt: BgtData) -> list[BgtFeature]:
    """Level-0 surface objects (bridges and their roads are level 1+; tunnels -1)."""
    return [f for f in bgt.layer(*GROUND_LAYERS) if f.level == 0 and f.geom.geom_type in ("Polygon", "MultiPolygon")]


def prepare_bgt_ground(bgt: BgtData) -> list[SurfacePatch]:
    out: list[SurfacePatch] = []
    kerbed: list[BaseGeometry] = []
    for f in ground_features(bgt):
        c = classify(f, in_centre(f.geom))
        if c is None:
            continue
        out.append(SurfacePatch(f.geom, palette.idx(c.colour), c.shape, c.priority, keep_feature=True))
        if f.layer == "wegdeel" and f.props.get("functie") in KERBED and f.props.get("plus_fysiek_voorkomen") not in FLUSH:
            kerbed.append(f.geom)
    if kerbed:
        # one strip around the union: no kerb lines between the parts of one carriageway
        road = unary_union(kerbed)
        kerb = road.buffer(KERB_M, join_style="mitre").difference(road)
        for g in getattr(kerb, "geoms", [kerb]):
            out.append(SurfacePatch(g, palette.idx(KERB_COLOUR), TILE, P_KERB_BGT, keep_feature=True))
    return out


def carriageways(bgt: BgtData) -> BaseGeometry | None:
    """Every level-0 surface cars and buses drive or park on (street props keep clear of it)."""
    geoms = [f.geom for f in ground_features(bgt) if f.layer == "wegdeel"
             and (f.props.get("functie") in CARRIAGEWAY or f.props.get("functie") in PARKING)]
    return unary_union(geoms) if geoms else None


def prepare_bgt_water(bgt: BgtData, osm: OsmData, dtm: HeightGrid, cfg: VoxelConfig,
                      reg: FeatureRegistry) -> list[WaterBody]:
    """BGT water surfaces. Level and name come from the OSM water (area or waterway) that
    overlaps the polygon most: the Maas keeps its fixed level, other water the bank estimate."""
    osm_water = [(w, w.geom) for w in osm.water] + [(w, w.geom.buffer(1.0)) for w in osm.waterways]
    parts = [f for f in bgt.layer("waterdeel") if f.level == 0 and f.geom.geom_type in ("Polygon", "MultiPolygon")]
    out = []
    water, shallow = palette.idx("water"), palette.idx("water_shallow")
    # the BGT cuts one river into many parts (at bridges, bends, owners): touching parts are one
    # body of water with one level, or seams show where the bank estimates differ
    for group in _touching(parts):
        geom = unary_union([f.geom for f in group])
        best, best_a = None, 0.0
        for w, g in osm_water:
            if g.intersects(geom):
                a = g.intersection(geom).area
                if a > best_a:
                    best, best_a = w, a
        maas = best is not None and is_maas(best.tags)
        level = cfg.maas_level_m if maas else bank_level(geom, dtm)
        name = best.name if best is not None else None
        fid = reg.add("water", geom, key=name, name=name, osm_id=best.osm_id) if (best is not None and name) else 0
        for f in group:
            shal = f.props.get("plus_type") in SHALLOW_WATER or f.props.get("type") in SHALLOW_WATER
            out.append(WaterBody(f.geom, level, shallow if shal else water, fid))
    return out


def _touching(feats: list[BgtFeature], gap_m: float = 0.5) -> list[list[BgtFeature]]:
    """Groups of features whose geometries touch (within ``gap_m``), in input order."""
    if not feats:
        return []
    tree = STRtree([f.geom for f in feats])
    parent = list(range(len(feats)))

    def root(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, f in enumerate(feats):
        for j in tree.query(f.geom, predicate="dwithin", distance=gap_m):
            a, b = root(i), root(int(j))
            if a != b:
                parent[max(a, b)] = min(a, b)
    groups: dict[int, list[BgtFeature]] = {}
    for i, f in enumerate(feats):
        groups.setdefault(root(i), []).append(f)
    return list(groups.values())


__all__ = ["classify", "carriageways", "ground_features", "prepare_bgt_ground", "prepare_bgt_water"]
