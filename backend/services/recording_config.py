"""
Shared accessor for RecordingConfig (models.py) — the single source of
truth for where recordings live and the storage-retention policy, used by
both services/recorder.py (writing new files) and routers/recordings.py
(reading/deleting existing ones). Having both resolve the same singleton
row is what fixes their previous disagreement (recorder.py hardcoded
/opt/arena/recordings; the router read a settings.RECORDINGS_DIR that was
never defined).
"""

from __future__ import annotations

from pathlib import Path

from sqlmodel import Session

from ..models import RecordingConfig

_CONFIG_ID = 1


def get_recording_config(session: Session) -> RecordingConfig:
    config = session.get(RecordingConfig, _CONFIG_ID)
    if config is None:
        config = RecordingConfig(id=_CONFIG_ID)
        session.add(config)
        session.commit()
        session.refresh(config)
    return config


def get_recordings_dir(session: Session) -> Path:
    return Path(get_recording_config(session).output_dir)
