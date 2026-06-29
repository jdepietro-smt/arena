from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
import os

from .database import create_db_and_tables, seed_default_admin
from .services.srt_stats import get_collector
from .routers import streams, routes, recordings, stats, users, hls_proxy
from .auth import router as auth_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    create_db_and_tables()
    seed_default_admin()
    await get_collector().start()
    yield
    # Shutdown
    await get_collector().stop()


app = FastAPI(
    title="Arena API",
    version="1.0.0",
    description="Professional Stream Management Platform",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routers
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(streams.router, prefix="/api/streams", tags=["streams"])
app.include_router(routes.router, prefix="/api/routes", tags=["routing"])
app.include_router(recordings.router, prefix="/api/recordings", tags=["recordings"])
app.include_router(stats.router, prefix="/api/stats", tags=["stats"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(hls_proxy.router, prefix="/api/hls", tags=["hls"])


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
