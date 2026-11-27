"""Write chunk files and the world directory (CONTRACT sections 4-6)."""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
import zlib
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from ..catalogue import Catalogue, catalogue_path, load_catalogue
from ..layout.records import CHUNK, KNOWN_FLAGS, RECORD_DTYPE, Records, chunk_keys, sort_records
from ..palette import palette_path
from .chunk_reader import read_chunk
from .format import FILE_RECORD_DTYPE, FLAG_DEFLATE, ChunkHeader, chunk_filename
from .island_writer import write_island
from .world_meta import features_document, manifest_document

log = logging.getLogger("blox")

CONTRACT_VERSION = 4  # manifest contractVersion (v3: islands, v4: slice from manifest); chunk binary itself is still BXC1 v1


@dataclass(frozen=True)
class ChunkInfo:
    cx: int
    cy: int
    file: str  # relative to the world dir, forward slashes
    bricks: int
    minK: int
    maxK: int
    sha1: str

    def manifest_entry(self) -> dict[str, Any]:
        return {"cx": self.cx, "cy": self.cy, "file": self.file, "bricks": self.bricks,
                "minK": self.minK, "maxK": self.maxK, "sha1": self.sha1}


def _validate(rec: Records, cx: int, cy: int, cat: Catalogue) -> None:
    if len(rec) == 0:
        raise ValueError("a chunk file needs at least one brick")
    kx, ky = chunk_keys(rec)
    if np.any(kx != cx) or np.any(ky != cy):
        raise ValueError(f"records outside chunk ({cx}, {cy})")
    ei, ej, eh = cat.extent_tables()
    t, rot = rec["type"].astype(np.int64), rec["rot"].astype(np.int64)
    if np.any(rot > 3) or np.any(ei[t, 0] == 0):
        raise ValueError("unknown brick type or rot > 3")
    li = rec["I"].astype(np.int64) - cx * CHUNK + ei[t, rot]
    lj = rec["J"].astype(np.int64) - cy * CHUNK + ej[t, rot]
    if np.any(li > CHUNK) or np.any(lj > CHUNK):
        raise ValueError("brick crosses a chunk border (the pipeline must split it)")
    k = rec["K"].astype(np.int64)
    if np.any(k < 0) or np.any(k + eh[t] > 0xFFFF):
        raise ValueError("brick k out of uint16 range")
    if np.any(rec["flags"] & ~np.uint8(KNOWN_FLAGS)):
        raise ValueError("unsupported flag bits")


def encode_chunk(rec: Records, cx: int, cy: int, *, compress: bool = True,
                 catalogue: Catalogue | None = None) -> bytes:
    """Bytes of one ``.bxc`` file; records are global, sorted here by (k, j, i)."""
    cat = catalogue or load_catalogue()
    rec = np.asarray(rec, RECORD_DTYPE)
    _validate(rec, cx, cy, cat)
    rec = sort_records(rec)
    body = np.zeros(len(rec), FILE_RECORD_DTYPE)
    body["i"] = rec["I"] - cx * CHUNK
    body["j"] = rec["J"] - cy * CHUNK
    body["k"] = rec["K"]
    body["typeId"] = rec["type"]
    body["colorIdx"] = rec["color"]
    body["rotFlags"] = (rec["rot"] & 3) | rec["flags"]
    body["featureId"] = rec["featureId"]
    raw = body.tobytes()
    if compress:
        co = zlib.compressobj(level=9, method=zlib.DEFLATED, wbits=-15)
        raw = co.compress(raw) + co.flush()
    _, _, eh = cat.extent_tables()
    hdr = ChunkHeader(
        cx=cx, cy=cy, brick_count=len(rec), min_k=int(rec["K"].min()),
        max_k=int((rec["K"].astype(np.int64) + eh[rec["type"]]).max()),
        body_bytes=len(raw), flags=FLAG_DEFLATE if compress else 0,
    )
    return hdr.pack() + raw


def write_chunk(world_dir: Path | str, rec: Records, cx: int, cy: int, *, compress: bool = True,
                catalogue: Catalogue | None = None) -> ChunkInfo:
    data = encode_chunk(rec, cx, cy, compress=compress, catalogue=catalogue)
    rel = f"chunks/{chunk_filename(cx, cy)}"
    path = Path(world_dir) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    hdr = ChunkHeader.unpack(data)
    return ChunkInfo(cx, cy, rel, hdr.brick_count, hdr.min_k, hdr.max_k, hashlib.sha1(data).hexdigest())


ChunkSource = Records | Mapping[Any, Records] | Iterable[Records]


def _iter_parts(chunks: ChunkSource) -> Iterable[Records]:
    if isinstance(chunks, np.ndarray):
        yield chunks
    elif isinstance(chunks, Mapping):
        yield from chunks.values()
    else:
        yield from chunks


def write_world(
    out_dir: Path | str, chunks: ChunkSource, features: Any = (), sources: Iterable[Mapping[str, Any]] = (),
    *, compress: bool = True, generated: str | None = None, catalogue: Catalogue | None = None,
    islands: Iterable[Any] = (),
) -> Path:
    """Write a complete world directory and return the manifest path.

    ``chunks``: one record array, an iterable of record arrays (e.g. a generator yielding
    one tile at a time) or a mapping of anything -> record array. Records are grouped by
    owning chunk; a chunk seen again in a later part is merged with what was written.
    ``features``: list of feature dicts or ``{"features": [...]}``. ``sources``: list of
    ``{"name", "version", "licence"}``. ``islands``: objects with ``id, cx, cy, records``
    (local I, J) and ``pose.origin`` / ``pose.yaw_deg`` (``islands.Island``), written to
    ``islands/*.bxi`` and listed in the manifest. Stale ``chunks/*.bxc`` and
    ``islands/*.bxi`` files are removed first.
    """
    cat = catalogue or load_catalogue()
    out = Path(out_dir)
    (out / "chunks").mkdir(parents=True, exist_ok=True)
    for stale in [*(out / "chunks").glob("*.bxc"), *(out / "islands").glob("*.bxi")]:
        stale.unlink()
    infos: dict[tuple[int, int], ChunkInfo] = {}
    for part in _iter_parts(chunks):
        part = np.asarray(part, RECORD_DTYPE)
        if len(part) == 0:
            continue
        kx, ky = chunk_keys(part)
        key = kx * 4096 + ky
        order = np.argsort(key, kind="stable")
        uniq, starts = np.unique(key[order], return_index=True)
        for u, a, b in zip(uniq, starts, list(starts[1:]) + [len(order)]):
            cx, cy = int(u // 4096), int(u % 4096)
            rec = part[order[a:b]]
            if (cx, cy) in infos:
                rec = np.concatenate([read_chunk(out / infos[(cx, cy)].file).records, rec])
            infos[(cx, cy)] = write_chunk(out, rec, cx, cy, compress=compress, catalogue=cat)
    shutil.copyfile(palette_path(), out / "palette.json")
    shutil.copyfile(catalogue_path(), out / "brick_catalogue.json")
    _write_json(out / "features.json", features_document(features))
    stamp = generated or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    entries = [infos[k].manifest_entry() for k in sorted(infos)]
    island_entries = [
        write_island(out, isl.records, isl.id, isl.cx, isl.cy, isl.pose.origin, isl.pose.yaw_deg,
                     compress=compress, catalogue=cat).manifest_entry()
        for isl in sorted(islands, key=lambda i: i.id) if len(isl.records)
    ]
    # An island is streamed with its owning chunk; if that chunk has no file the island is
    # never loaded by a renderer. Ground normally guarantees it, so this only warns.
    orphans = [e["id"] for e in island_entries if (e["cx"], e["cy"]) not in infos]
    if orphans:
        log.warning("islands %s: owning chunk not in the manifest, renderers will never load them", orphans)
    manifest = manifest_document(CONTRACT_VERSION, stamp, sources, entries, island_entries)
    _write_json(out / "manifest.json", manifest)
    return out / "manifest.json"


def _write_json(path: Path, doc: Any) -> None:
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
