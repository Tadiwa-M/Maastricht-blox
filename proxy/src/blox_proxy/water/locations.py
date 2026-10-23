"""Helper CLI: list RWS DDAPI20 locations whose name matches a pattern.

Run on a networked PC to find the code for Maastricht Sint Pieter / Borgharen, then put it
in the env var BLOX_RWS_LOCATION:

    uv run blox-proxy-rws-locations            # default pattern: pieter|borgharen|maastricht
    uv run blox-proxy-rws-locations "eijsden"
"""

from __future__ import annotations

import re
import sys
from typing import Any

import httpx

from ..config import USER_AGENT, Settings

CATALOGUE_PATH = "/METADATASERVICES/OphalenCatalogus"


def filter_locations(doc: dict[str, Any], pattern: str) -> list[tuple[str, str]]:
    rx = re.compile(pattern, re.IGNORECASE)
    out = []
    for loc in doc.get("LocatieLijst") or []:
        name, code = str(loc.get("Naam") or ""), str(loc.get("Code") or "")
        if rx.search(name) or rx.search(code):
            out.append((code, name))
    return sorted(set(out))


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    pattern = args[0] if args else "pieter|borgharen|maastricht"
    url = Settings.from_env().rws_base_url.rstrip("/") + CATALOGUE_PATH
    body = {"CatalogusFilter": {"Grootheden": True, "Compartimenten": True, "Eenheden": True}}
    resp = httpx.post(url, json=body, headers={"User-Agent": USER_AGENT}, timeout=120.0)
    resp.raise_for_status()
    rows = filter_locations(resp.json(), pattern)
    for code, name in rows:
        print(f"{code}\t{name}")
    if not rows:
        print(f"no locations match {pattern!r}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
