"""
Smoke test: the FastAPI app must actually import and construct cleanly.

This exact class of failure took the production service down for real this
session — an .env value for a setting that didn't exist yet on the deployed
code raised a pydantic ValidationError at module import time (`Settings()`
in config.py), which crashes uvicorn on every single startup attempt
(systemd's auto-restart just kept hitting the same crash). None of the
other tests import backend.main at all, so nothing would have caught that
class of bug before deploy. This is deliberately dumb and cheap — it's not
testing behavior, just that constructing the app doesn't blow up.
"""

from __future__ import annotations


def test_app_imports_and_has_routes():
    from backend.main import app

    assert len(app.routes) > 0
