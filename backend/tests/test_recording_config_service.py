"""
Tests for services.recording_config — the shared RecordingConfig
singleton accessor used by both recorder.py and the recordings router,
whose previous disagreement (hardcoded dir vs. an undefined settings
attribute) this module exists to fix.
"""

from __future__ import annotations

from pathlib import Path

from backend.models import RecordingConfig
from backend.services.recording_config import get_recording_config, get_recordings_dir


def test_get_recording_config_creates_default_row_on_first_access(db_session):
    config = get_recording_config(db_session)

    assert config.id == 1
    assert config.output_dir == "/opt/arena/recordings"
    assert config.max_storage_gb == 500.0
    assert config.auto_delete is False


def test_get_recording_config_returns_same_row_on_second_access(db_session):
    first = get_recording_config(db_session)
    first.output_dir = "/mnt/custom"
    db_session.add(first)
    db_session.commit()

    second = get_recording_config(db_session)

    assert second.id == 1
    assert second.output_dir == "/mnt/custom"


def test_get_recordings_dir_reflects_configured_output_dir(db_session):
    config = get_recording_config(db_session)
    config.output_dir = "/mnt/recordings-here"
    db_session.add(config)
    db_session.commit()

    result = get_recordings_dir(db_session)

    assert result == Path("/mnt/recordings-here")
