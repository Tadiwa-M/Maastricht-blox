"""City life exports (``blox life``): timetable buses, walkways and the river for the web game.

Everything here is pre-baked from open data so the viewer needs no server:

* ``transit.py``  GTFS static (OVapi national feed) -> routes, shapes, trip patterns, one week
* ``walkways.py`` OSM footways, pedestrian streets, sidewalks, squares -> a walk graph
* ``river.py``    the Maas centreline for the cruise boats
* ``export.py``   writes ``<world>/life/{index,transit,walkways,river}.json``

Coordinates are Unity world metres (CONTRACT 1): ``x`` east, ``z`` north, rounded to 0.1 m.
The format is documented in ``docs/guide/05-movers-and-models.md``.
"""

from .export import LIFE_VERSION, export_life

__all__ = ["LIFE_VERSION", "export_life"]
