"""Entry points: ``blox-proxy`` (serve) and ``blox-proxy-build-gtfs`` (offline preprocessing)."""

from __future__ import annotations

import argparse
import asyncio
import logging
from pathlib import Path

import uvicorn

from .api import create_app
from .config import Settings
from .gtfs.static import GtfsStatic
from .http import make_client
from .service import LiveService


def _logging(verbose: bool) -> None:
    logging.basicConfig(level=logging.DEBUG if verbose else logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def main(argv: list[str] | None = None) -> None:
    settings = Settings.from_env()
    ap = argparse.ArgumentParser(prog="blox-proxy", description="Maastricht Blox live-data proxy")
    ap.add_argument("--host", default=settings.host)
    ap.add_argument("--port", type=int, default=settings.port)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    _logging(args.verbose)
    app = create_app(LiveService(settings))
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


def build_gtfs_main(argv: list[str] | None = None) -> None:
    """Download (if changed) and preprocess the GTFS feed, or preprocess a local zip."""
    settings = Settings.from_env()
    ap = argparse.ArgumentParser(prog="blox-proxy-build-gtfs")
    ap.add_argument("--zip", type=Path, help="use this local gtfs-nl.zip instead of downloading")
    args = ap.parse_args(argv)
    _logging(False)
    static = GtfsStatic(settings)
    if args.zip:
        settings.cache_dir.mkdir(parents=True, exist_ok=True)
        idx = static.rebuild_from_zip(args.zip)
    else:
        async def run() -> None:
            async with make_client() as client:
                await static.refresh(client)
        asyncio.run(run())
        idx = static.index
    print(f"GTFS slice cache: {static.cache_path} ({len(idx.routes)} routes, {len(idx.trips)} trips, {len(idx.shapes)} shapes, {len(idx.stops)} stops)")
