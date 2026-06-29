"""Arena API routers package."""

from .recordings import router as recordings_router
from .routes import router as routes_router
from .stats import router as stats_router
from .streams import router as streams_router
from .users import router as users_router

__all__ = [
    "streams_router",
    "routes_router",
    "recordings_router",
    "stats_router",
    "users_router",
]
