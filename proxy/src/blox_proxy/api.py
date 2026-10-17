"""FastAPI app implementing CONTRACT.md section 8."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .service import LiveService


def _unavailable(what: str) -> JSONResponse:
    return JSONResponse(status_code=503, content={"error": f"no {what} data yet; see /v1/health"})


def create_app(service: LiveService, run_background: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if run_background:
            await service.start()
        try:
            yield
        finally:
            if run_background:
                await service.stop()

    app = FastAPI(title="Maastricht Blox live proxy", version="1", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

    @app.middleware("http")
    async def no_store(request: Request, call_next: Any) -> Response:
        resp: Response = await call_next(request)
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/v1/health")
    def health() -> dict[str, Any]:
        return service.health()

    @app.get("/v1/vehicles")
    def vehicles() -> dict[str, Any]:
        return service.vehicles_payload()

    @app.get("/v1/shapes")
    def shapes() -> dict[str, Any]:
        return service.shapes()

    @app.get("/v1/stops")
    def stops() -> dict[str, Any]:
        return service.stops()

    @app.get("/v1/weather", response_model=None)
    def weather() -> dict[str, Any] | JSONResponse:
        return service.weather if service.weather is not None else _unavailable("weather")

    @app.get("/v1/water", response_model=None)
    def water() -> dict[str, Any] | JSONResponse:
        return service.water if service.water is not None else _unavailable("water")

    return app
