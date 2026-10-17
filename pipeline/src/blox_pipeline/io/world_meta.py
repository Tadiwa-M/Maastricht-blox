"""``manifest.json`` (CONTRACT section 5) and ``features.json`` (section 6) documents."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

FEATURE_KINDS = frozenset({"building", "landmark", "poi", "street", "water", "park", "station", "stop"})
ORIGIN_RD = [175700, 316500]


def features_document(features: Any) -> dict[str, Any]:
    """Normalise to ``{"features": [...]}`` and check ids/kinds."""
    items = features.get("features", []) if isinstance(features, Mapping) else list(features)
    seen: set[int] = set()
    out = []
    for f in items:
        f = dict(f)
        fid = f.get("id")
        if not isinstance(fid, int) or not 1 <= fid <= 0xFFFFFFFF:
            raise ValueError(f"feature id must be a uint32 >= 1, got {fid!r}")
        if fid in seen:
            raise ValueError(f"duplicate feature id {fid}")
        if f.get("kind") not in FEATURE_KINDS:
            raise ValueError(f"feature {fid}: kind {f.get('kind')!r} not in {sorted(FEATURE_KINDS)}")
        seen.add(fid)
        out.append(f)
    out.sort(key=lambda f: f["id"])
    return {"features": out}


def manifest_document(contract_version: int, generated: str, sources: Iterable[Mapping[str, Any]],
                      chunk_entries: list[dict[str, Any]]) -> dict[str, Any]:
    src = []
    for s in sources:
        missing = {"name", "version", "licence"} - set(s)
        if missing:
            raise ValueError(f"source {s!r} lacks {sorted(missing)}")
        src.append(dict(s))
    return {
        "contractVersion": contract_version,
        "crs": "EPSG:28992",
        "originRD": ORIGIN_RD,
        "baseNapM": 30.0,
        "studM": 0.5,
        "plateM": 0.2,
        "chunkStuds": 64,
        "chunksX": 64,
        "chunksY": 64,
        "palette": "palette.json",
        "catalogue": "brick_catalogue.json",
        "features": "features.json",
        "generated": generated,
        "sources": src,
        "chunks": chunk_entries,
    }
