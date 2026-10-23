"""Optional PDOK aerial orthophoto (WMS), sampled at stud resolution for colour hints."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from .. import geo
from ..geo import RDBox
from . import config
from .http import PNG_MAGIC, download, expect_magic, make_session
from .model import RGBGrid


def block_path(block: RDBox, root: Path | None = None) -> Path:
    return (root or config.data_dir()) / "ortho" / f"{int(block.xmin)}_{int(block.ymin)}_{int(block.xmax - block.xmin)}.png"


def wms_params(block: RDBox) -> dict[str, str]:
    px = int(round((block.xmax - block.xmin) * config.ORTHO_PX_PER_M))
    return {
        "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap",
        "LAYERS": config.ORTHO_LAYER, "STYLES": "", "CRS": "EPSG:28992",
        "BBOX": f"{block.xmin},{block.ymin},{block.xmax},{block.ymax}",
        "WIDTH": str(px), "HEIGHT": str(px), "FORMAT": "image/png",
    }


def fetch_ortho(bbox: RDBox, root: Path | None = None) -> list[Path]:
    sess = make_session()
    out = []
    for block in geo.iter_blocks(bbox, config.ORTHO_BLOCK_M):
        out.append(download(config.ORTHO_WMS_URL, block_path(block, root), params=wms_params(block),
                            session=sess, validate=expect_magic(*PNG_MAGIC)))
    return out


def load_ortho(bbox: RDBox, root: Path | None = None) -> RGBGrid | None:
    """Mosaic cached blocks; ``None`` if nothing was downloaded (ortho is optional)."""
    box = geo.rd_box_to_cells(bbox)
    rgb = np.zeros((box.ni, box.nj, 3), dtype=np.uint8)
    found = False
    for block in geo.iter_blocks(bbox, config.ORTHO_BLOCK_M):
        p = block_path(block, root)
        if not p.exists():
            continue
        found = True
        img = np.asarray(Image.open(p).convert("RGB"))
        n = int(round((block.xmax - block.xmin) / geo.STUD_M))
        if img.shape[0] != n or img.shape[1] != n:
            img = np.asarray(Image.fromarray(img).resize((n, n), Image.Resampling.BOX))
        cells = img.transpose(1, 0, 2)[:, ::-1]  # rows north->south -> [i, j]
        bi, bj = geo.rd_to_grid(block.xmin, block.ymin)
        a0, b0 = max(box.i0, bi), max(box.j0, bj)
        a1, b1 = min(box.i1, bi + n), min(box.j1, bj + n)
        if a0 < a1 and b0 < b1:
            rgb[a0 - box.i0 : a1 - box.i0, b0 - box.j0 : b1 - box.j0] = cells[a0 - bi : a1 - bi, b0 - bj : b1 - bj]
    return RGBGrid(box.i0, box.j0, rgb) if found else None
