import logging

from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from contextlib import asynccontextmanager
import os

from .config import DEFAULT_SECRET_KEY, settings
from .database import create_db_and_tables, seed_default_admin
from .services.alerting import get_alert_manager
from .services.redundancy import get_redundancy_monitor
from .services.retention import get_recording_retention
from .services.db_backup import get_db_backup
from .services.managed_paths import reconcile_orphans
from .services.srt_stats import get_collector
from .services.compositor import get_compositor
from .services.external_source import get_external_sources
from .services.hls_generator import get_hls_generator
from .services.qc_monitor import get_qc_monitor
from .services.mediamtx import get_client
from .services.rate_limiter import check_and_record
from .routers import (
    streams, routes, recordings, stats, users, hls_proxy, whep_proxy,
    multiview, external_sources, alerts, redundancy, settings as settings_router,
    events, assistant, audit, favorites, qc,
)
from .auth import router as auth_router

logger = logging.getLogger(__name__)


async def _apply_srt_publish_passphrase() -> None:
    # Without this, mediamtx's SRT listener accepts a publish under any
    # streamid from anyone who reaches the port — confirmed live (an
    # unrecognized stream showed up under an arbitrary name). Applied every
    # startup so it survives a passphrase change in .env without needing a
    # one-off manual API call, and so a fresh mediamtx instance is never left
    # unconfigured.
    #
    # srtPublishPassphrase is a PER-PATH setting, not global — confirmed by
    # a live 400 ("json: unknown field") from PATCHing it via the global
    # config endpoint. It lives on the "all" wildcard path (the one entry
    # in mediamtx.yml, source: publisher), which every concrete stream path
    # falls back to, so patching "all" covers every publish.
    if not settings.SRT_PUBLISH_PASSPHRASE:
        logger.warning(
            "SRT_PUBLISH_PASSPHRASE is unset — the SRT publish port accepts "
            "a stream under any name from anyone who can reach it. Set "
            "SRT_PUBLISH_PASSPHRASE in .env (10-79 chars) to close this."
        )
        return
    try:
        await get_client().patch_path_config("all", {"srtPublishPassphrase": settings.SRT_PUBLISH_PASSPHRASE})
    except Exception:
        logger.exception("Failed to apply SRT_PUBLISH_PASSPHRASE to mediamtx")


def _warn_if_default_secret_key() -> None:
    # Every unconfigured deployment shares this same publicly-visible key
    # (it's right here in the source) — anyone can forge a valid admin JWT
    # for it without ever authenticating. Unlike SRT_PUBLISH_PASSPHRASE this
    # can't be left blank (JWTs wouldn't work at all), so the only signal
    # available is a loud warning; there's no safe default to fall back to.
    if settings.SECRET_KEY == DEFAULT_SECRET_KEY:
        logger.warning(
            "SECRET_KEY is still the default value from source — anyone can "
            "forge a valid admin token. Set a unique SECRET_KEY in .env "
            "(e.g. `python3 -c 'import secrets; print(secrets.token_hex(32))'`) "
            "and restart."
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    create_db_and_tables()
    seed_default_admin()
    _warn_if_default_secret_key()
    await reconcile_orphans()
    await _apply_srt_publish_passphrase()
    await get_collector().start()
    get_compositor().start_reaper()
    get_hls_generator().start()
    get_qc_monitor().start()
    get_alert_manager().start()
    get_redundancy_monitor().start()
    get_recording_retention().start()
    get_db_backup().start()
    yield
    # Shutdown
    await get_collector().stop()
    await get_compositor().stop()
    await get_external_sources().stop_all()
    await get_hls_generator().stop_all()
    await get_qc_monitor().stop_all()
    await get_alert_manager().stop()
    await get_redundancy_monitor().stop()
    await get_recording_retention().stop()
    await get_db_backup().stop()


app = FastAPI(
    title="Arena API",
    version="1.0.0",
    description="Professional Stream Management Platform",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _security_headers(request, call_next):
    response = await call_next(request)
    # Zero functional risk, real value: the dashboard has no reason to be
    # framed by another site, and browsers guessing content-types from
    # bytes rather than trusting our Content-Type header has been a classic
    # XSS vector for file-serving endpoints (recordings/thumbnails).
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# Coarse per-IP backstop across the whole API — only /auth/token had any
# throttling before this (services/login_limiter.py); every other route,
# including recording start/stop, source ingestion, and DB backup
# triggers, had zero pushback against a client hammering it in a loop.
# Generous on purpose: the dashboard itself polls several REST endpoints
# every few seconds, often from more than one open tab/panel on the same
# IP, and this must never be what makes normal use flaky. It's a
# ceiling against abuse, not a per-endpoint throttle — see
# services/rate_limiter.py's rate_limit() dependency for the tighter,
# per-action limits applied to specific expensive endpoints below.
_GLOBAL_RATE_LIMIT = 600
_GLOBAL_RATE_WINDOW_S = 60.0


@app.middleware("http")
async def _global_rate_limit(request, call_next):
    client_ip = request.client.host if request.client else "unknown"
    retry_after = check_and_record(f"global:{client_ip}", _GLOBAL_RATE_LIMIT, _GLOBAL_RATE_WINDOW_S)
    if retry_after is not None:
        wait_s = int(retry_after) + 1
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"detail": f"Too many requests. Try again in {wait_s}s."},
            headers={"Retry-After": str(wait_s)},
        )
    return await call_next(request)

# API routers
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(streams.router, prefix="/api/streams", tags=["streams"])
app.include_router(routes.router, prefix="/api/routes", tags=["routing"])
app.include_router(recordings.router, prefix="/api/recordings", tags=["recordings"])
app.include_router(stats.router, prefix="/api/stats", tags=["stats"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(hls_proxy.router, prefix="/api/hls", tags=["hls"])
app.include_router(whep_proxy.router, prefix="/api/whep", tags=["whep"])
app.include_router(multiview.router, prefix="/api/multiview", tags=["multiview"])
app.include_router(external_sources.router, prefix="/api/sources", tags=["sources"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["alerts"])
app.include_router(redundancy.router, prefix="/api/redundancy", tags=["redundancy"])
app.include_router(settings_router.router, prefix="/api/settings", tags=["settings"])
app.include_router(events.router, prefix="/api/events", tags=["events"])
app.include_router(assistant.router, prefix="/api/assistant", tags=["assistant"])
app.include_router(audit.router, prefix="/api/audit", tags=["audit"])
app.include_router(favorites.router, prefix="/api/favorites", tags=["favorites"])
app.include_router(qc.router, prefix="/api/qc", tags=["qc"])


@app.get("/api/health", tags=["health"])
async def health():
    return {"status": "ok"}


# Serve React frontend in production
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        from fastapi import HTTPException
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(os.path.join(frontend_dist, "index.html"))
