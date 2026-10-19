"""``python -m blox_pipeline.models [--out DIR]``: write every brick model as JSON."""

from __future__ import annotations

import argparse
from pathlib import Path

from . import BUILDERS, models_dir, write_model
from .document import model_records


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Generate the brick model files (bus, boat, character).")
    ap.add_argument("--out", type=Path, default=None, help=f"output directory (default {models_dir()})")
    ap.add_argument("--preview", type=Path, default=None, help="also write <name>.png iso previews here")
    args = ap.parse_args(argv)
    for name, build in BUILDERS.items():
        doc = build().document()
        path = write_model(doc, args.out)
        if args.preview:
            from ..preview import render_chunk_iso

            args.preview.mkdir(parents=True, exist_ok=True)
            render_chunk_iso(model_records(doc), args.preview / f"{name}.png", scale=14)
        print(f"{name:10s} {len(doc['bricks']):4d} bricks  size {doc['size']}  parts {list(doc['parts'])} -> {path}")


if __name__ == "__main__":
    main()
