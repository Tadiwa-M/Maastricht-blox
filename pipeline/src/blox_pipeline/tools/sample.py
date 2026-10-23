"""Export a small neighbourhood of a built world into ``samples/<name>/`` so it can be committed.

Real-world builds live in the git-ignored ``build/world``. A sample of a few dozen chunks (about
1 MB) is small enough to push, so the cloud session can render and debug real data too.

    uv run python -m blox_pipeline.tools.sample --around markt            # -> ../samples/markt
    uv run python -m blox_pipeline.tools.sample --around 22,47 --radius 2 --name test
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from ..catalogue import repo_root
from ..io.chunk_reader import read_manifest
from .places import resolve_place

CHUNK = 64


def export_sample(world: Path, out: Path, centre: tuple[int, int], radius: int) -> dict:
    manifest = read_manifest(world)
    keep = [c for c in manifest["chunks"]
            if abs(c["cx"] - centre[0]) <= radius and abs(c["cy"] - centre[1]) <= radius]
    if not keep:
        raise SystemExit(f"no chunks within {radius} of {centre}")
    if out.exists():
        shutil.rmtree(out)
    (out / "chunks").mkdir(parents=True)
    for c in keep:
        shutil.copy2(world / c["file"], out / c["file"])
    islands = [isl for isl in manifest.get("islands", [])
               if abs(isl["cx"] - centre[0]) <= radius and abs(isl["cy"] - centre[1]) <= radius]
    if islands:
        (out / "islands").mkdir()
        for isl in islands:
            shutil.copy2(world / isl["file"], out / isl["file"])
    for key in ("palette", "catalogue"):
        shutil.copy2(world / manifest[key], out / manifest[key])

    i0, j0 = (centre[0] - radius) * CHUNK, (centre[1] - radius) * CHUNK
    i1, j1 = (centre[0] + radius + 1) * CHUNK, (centre[1] + radius + 1) * CHUNK
    feats = json.loads((world / manifest["features"]).read_text(encoding="utf-8"))["features"]
    near = [f for f in feats if "bboxIJ" in f and f["bboxIJ"][0] < i1 and f["bboxIJ"][2] >= i0
            and f["bboxIJ"][1] < j1 and f["bboxIJ"][3] >= j0]
    (out / manifest["features"]).write_text(json.dumps({"features": near}), encoding="utf-8")

    manifest = {**manifest, "chunks": keep, "islands": islands,
                "sample": {"centre": list(centre), "radius": radius}}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    files = [c["file"] for c in keep] + [i["file"] for i in islands]
    return {"chunks": len(keep), "islands": len(islands), "features": len(near),
            "bytes": sum((out / f).stat().st_size for f in files)}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--world", type=Path, default=repo_root() / "build" / "world")
    ap.add_argument("--around", required=True, help="markt, vrijthof, brug, station, bonnefanten or cx,cy")
    ap.add_argument("--radius", type=int, default=3, help="in chunks (default 3: 7x7 chunks)")
    ap.add_argument("--name", help="sample folder name (default: the place)")
    a = ap.parse_args(argv)
    out = repo_root() / "samples" / (a.name or a.around.replace(",", "_"))
    st = export_sample(a.world, out, resolve_place(a.around), a.radius)
    print(f"wrote {out}: {st['chunks']} chunks, {st['islands']} islands, {st['features']} features, {st['bytes'] / 1024:.0f} KiB")


if __name__ == "__main__":
    main()
