"""Local reader and invitation-authenticated hardware connection test."""
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api import auth, health, lovense
from app.core.body_limit import BodyLimitMiddleware
from app.core.config import Settings, load_settings
from app.db.store import Store
from app.services.lovense import LovenseTokens

STATIC = Path(__file__).resolve().parent / "static"
VENDOR_HTTPS = "https://*.lovense.com https://*.lovense-api.com https://*.lovense.club:*"
VENDOR_WSS = "wss://*.lovense.com wss://*.lovense-api.com wss://*.lovense.club:*"


def content_policy(path: str, origin: str):
    if path in {"/device-bridge", "/static/device-bridge.html"}:
        # The SDK has no same-origin capability, API access or access to reader text.
        return (
            "default-src 'none'; sandbox allow-scripts; "
            f"script-src {origin} https://api.lovense-api.com; "
            f"connect-src {VENDOR_HTTPS} {VENDOR_WSS}; "
            f"img-src {VENDOR_HTTPS}; style-src {origin}; "
            "object-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
        )
    if path in {"/device-check", "/static/device-check.html"}:
        return (
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; "
            "frame-src 'self'; img-src 'self' https://*.lovense-api.com https://*.lovense.com; "
            "object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        )
    return (
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; "
        "frame-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    )


def create_app(settings: Settings | None = None, *, store=None, lovense_tokens=None) -> FastAPI:
    settings = settings or load_settings()
    application = FastAPI(title="SatinLore local development", docs_url=None, redoc_url=None, openapi_url=None)
    application.state.settings = settings
    application.state.store = store or Store(settings.database_path)
    application.state.lovense_tokens = lovense_tokens or LovenseTokens(settings.lovense_developer_token)
    application.add_middleware(BodyLimitMiddleware)
    application.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=list({"localhost", "127.0.0.1", "testserver", urlsplit(settings.app_origin).hostname}),
    )

    @application.middleware("http")
    async def browser_headers(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = content_policy(request.url.path, settings.app_origin)
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if request.url.path.startswith("/static/") and request.url.path.endswith(".mjs") and response.status_code == 200:
            # Public code only: opaque sandbox module fetches use Origin:null.
            response.headers["Access-Control-Allow-Origin"] = "*"
        return response

    application.include_router(health.router, prefix="/api")
    application.include_router(auth.router, prefix="/api")
    application.include_router(lovense.router, prefix="/api")

    @application.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    @application.get("/device-check")
    def device_check():
        return FileResponse(STATIC / "device-check.html")

    @application.get("/device-bridge")
    def device_bridge():
        return FileResponse(STATIC / "device-bridge.html")

    application.mount("/static", StaticFiles(directory=STATIC), name="static")
    return application


app = create_app()
