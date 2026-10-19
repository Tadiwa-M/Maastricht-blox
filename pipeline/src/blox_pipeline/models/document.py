"""Read, check and write brick model files (``contract/models/<name>.json``, CONTRACT 7.1).

``check_model`` is independent of the builder (it re-derives every cell from the
records with the shared rotation helpers), so it also guards hand-edited files.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..catalogue import Catalogue, contract_dir, load_catalogue
from ..palette import Palette, load_palette
from ..rotation import footprint_cells

REQUIRED = ("name", "version", "size", "pivot", "forward", "bricks")


def models_dir() -> Path:
    return contract_dir() / "models"


def brick_cells(b: dict[str, Any], cat: Catalogue) -> list[tuple[int, int, int]]:
    t = cat[int(b["type"])]
    return [(b["i"] + di, b["j"] + dj, b["k"] + dk)
            for _, _, di, dj in footprint_cells(t.w, t.d, int(b["rot"])) for dk in range(t.h)]


def check_model(doc: dict[str, Any], cat: Catalogue | None = None,
                pal: Palette | None = None) -> list[str]:
    """Problems with a model document (empty list = valid)."""
    cat = cat or load_catalogue()
    pal = pal or load_palette()
    errs = [f"missing field {f!r}" for f in REQUIRED if f not in doc]
    if errs:
        return errs
    if doc["forward"] != "+j":
        errs.append("models always face +j")
    size = doc["size"]
    parts = doc.get("parts", {})
    for name, p in parts.items():
        if not all(0 <= p["pivot"][n] <= size[n] for n in range(3)):
            errs.append(f"part {name}: pivot {p['pivot']} outside the model box {size}")
    if not all(0 <= doc["pivot"][n] <= size[n] for n in range(3)):
        errs.append(f"model pivot {doc['pivot']} outside the model box {size}")
    seen: dict[tuple[int, int, int], int] = {}
    for n, b in enumerate(doc["bricks"]):
        if int(b["type"]) not in cat:
            errs.append(f"brick #{n}: unknown type {b['type']}")
            continue
        if int(b["rot"]) not in (0, 1, 2, 3):
            errs.append(f"brick #{n}: rot {b['rot']}")
            continue
        if int(b["color"]) == 0 or int(b["color"]) not in {e.idx for e in pal.entries}:
            errs.append(f"brick #{n}: colour {b['color']} not in the palette")
        if "part" in b and b["part"] not in parts:
            errs.append(f"brick #{n}: unknown part {b['part']!r}")
        for c in brick_cells(b, cat):
            if not all(0 <= c[m] < size[m] for m in range(3)):
                errs.append(f"brick #{n} cell {c} outside the model box {size}")
                break
            if c in seen:
                errs.append(f"brick #{n} overlaps brick #{seen[c]} at {c}")
                break
            seen[c] = n
    return errs


def write_model(doc: dict[str, Any], out_dir: Path | None = None) -> Path:
    errs = check_model(doc)
    if errs:
        raise ValueError(f"model {doc.get('name')}: " + "; ".join(errs[:5]))
    out = (out_dir or models_dir())
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{doc['name']}.json"
    # one brick per line: readable diffs without a 5000-line file
    head = {k: v for k, v in doc.items() if k != "bricks"}
    lines = ",\n".join("  " + json.dumps(b, separators=(", ", ": ")) for b in doc["bricks"])
    text = json.dumps(head, indent=1)[:-2] + ',\n "bricks": [\n' + lines + "\n ]\n}\n"
    json.loads(text)  # guard the hand-rolled formatting
    path.write_text(text, encoding="utf-8")
    return path


def model_records(doc: dict[str, Any]):
    """Bricks as layout records (``RECORD_DTYPE``, model-local cells), e.g. for previews."""
    import numpy as np

    from ..layout.records import RECORD_DTYPE

    rec = np.zeros(len(doc["bricks"]), RECORD_DTYPE)
    for n, b in enumerate(doc["bricks"]):
        rec[n] = (b["i"], b["j"], b["k"], b["type"], b["color"], b["rot"], 0, 0)
    return rec


def load_model(path: Path | str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))
