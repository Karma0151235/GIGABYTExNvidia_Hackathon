from __future__ import annotations

import importlib.util
import logging
import os
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("anwar.backend")

BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent
MODULES_DIR = BASE_DIR / "modules"

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def load_runtime_env() -> None:
    """Load local config for direct `uvicorn` starts without overriding shell env."""
    for path in (BASE_DIR / ".env.local", BASE_DIR / ".env", REPO_ROOT / ".env.local", REPO_ROOT / ".env"):
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            key, separator, value = line.strip().partition("=")
            value = value.strip().strip('"').strip("'")
            if separator and key and value and not key.startswith("#"):
                os.environ.setdefault(key, value)


load_runtime_env()


def discover_module_slugs() -> list[str]:
    if not MODULES_DIR.exists():
        return []

    return sorted(
        path.name
        for path in MODULES_DIR.iterdir()
        if path.is_dir() and not path.name.startswith(".") and not path.name.startswith("__")
    )


def create_app() -> FastAPI:
    app = FastAPI(
        title="ANWAR Unified API",
        version="0.1.0",
        description="Single backend API for all ANWAR modules. Default port: 8000.",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    module_statuses: list[dict[str, str]] = []

    for slug in discover_module_slugs():
        router_file = MODULES_DIR / slug / "api" / "router.py"

        if not router_file.exists():
            module_statuses.append({"module": slug, "status": "placeholder"})
            continue

        try:
            spec = importlib.util.spec_from_file_location(
                f"anwar_backend_{slug.replace('-', '_')}_router",
                router_file,
            )
            if spec is None or spec.loader is None:
                module_statuses.append({"module": slug, "status": "invalid-router-spec"})
                continue

            router_module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(router_module)
        except Exception as exc:
            logger.warning("Failed to load router for %s: %s", slug, exc)
            module_statuses.append({"module": slug, "status": "load-error"})
            continue

        router = getattr(router_module, "router", None)
        if router is None:
            logger.warning("Router file found but no `router` object exported: %s", router_file)
            module_statuses.append({"module": slug, "status": "missing-router-object"})
            continue

        app.include_router(router, prefix=f"/api/{slug}", tags=[slug])
        module_statuses.append({"module": slug, "status": "loaded"})

    @app.get("/health")
    async def health() -> dict[str, object]:
        return {
            "status": "ok",
            "api_port": 8000,
            "service": "anwar-unified-api",
            "modules": module_statuses,
        }

    @app.get("/")
    async def root() -> dict[str, object]:
        return {
            "name": "ANWAR Unified API",
            "port": 8000,
            "docs": "/docs",
            "health": "/health",
            "module_base_path": "/api/{module-slug}",
            "modules": module_statuses,
        }

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("backend.server:app", host="0.0.0.0", port=port, reload=True)
