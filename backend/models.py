from __future__ import annotations

import enum
from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, EmailStr
from sqlmodel import Column, Field, JSON, SQLModel


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class UserRole(str, enum.Enum):
    admin = "admin"
    operator = "operator"
    viewer = "viewer"


class RecordingStatus(str, enum.Enum):
    recording = "recording"
    complete = "complete"
    error = "error"


class MetricType(str, enum.Enum):
    bitrate = "bitrate"
    rtt = "rtt"
    packet_loss = "packet_loss"


class CompareOperator(str, enum.Enum):
    lt = "lt"
    gt = "gt"


class AlertAction(str, enum.Enum):
    email = "email"
    webhook = "webhook"


# ---------------------------------------------------------------------------
# SQLModel tables
# ---------------------------------------------------------------------------


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True, min_length=1, max_length=64)
    email: str = Field(index=True, unique=True)
    hashed_password: str
    role: UserRole = Field(default=UserRole.viewer)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class StreamRoute(SQLModel, table=True):
    __tablename__ = "stream_routes"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True, min_length=1, max_length=128)
    source_path: str = Field(description="MediaMTX path that is the source")
    # JSON list of dicts: [{"type": "srt|hls|rtmp|record", "url": "..."}, ...]
    destinations: List[Any] = Field(default_factory=list, sa_column=Column(JSON))
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class StreamPreset(SQLModel, table=True):
    __tablename__ = "stream_presets"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True, min_length=1, max_length=128)
    srt_url: str
    description: Optional[str] = Field(default=None)
    # JSON list of strings e.g. ["sports", "4k"]
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))


class Recording(SQLModel, table=True):
    __tablename__ = "recordings"

    id: Optional[int] = Field(default=None, primary_key=True)
    stream_path: str = Field(index=True)
    filename: str
    size_bytes: int = Field(default=0)
    duration_seconds: float = Field(default=0.0)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    ended_at: Optional[datetime] = Field(default=None)
    status: RecordingStatus = Field(default=RecordingStatus.recording)


class AlertRule(SQLModel, table=True):
    __tablename__ = "alert_rules"

    id: Optional[int] = Field(default=None, primary_key=True)
    stream_path: str = Field(index=True)
    metric: MetricType
    operator: CompareOperator
    threshold: float
    action: AlertAction
    is_active: bool = Field(default=True)


# ---------------------------------------------------------------------------
# Pydantic request / response schemas  (not DB tables)
# ---------------------------------------------------------------------------


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: UserRole = UserRole.viewer


class UserRead(BaseModel):
    id: int
    username: str
    email: str
    role: UserRole
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[UserRole] = None


class RouteCreate(BaseModel):
    name: str
    source_path: str
    destinations: List[dict] = []
    is_active: bool = True


class RouteRead(BaseModel):
    id: int
    name: str
    source_path: str
    destinations: List[Any]
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class RecordingRead(BaseModel):
    id: int
    stream_path: str
    filename: str
    size_bytes: int
    duration_seconds: float
    started_at: datetime
    ended_at: Optional[datetime]
    status: RecordingStatus

    model_config = {"from_attributes": True}


class StreamInfo(BaseModel):
    """Normalised view of a single MediaMTX path/stream."""

    path: str
    ready: bool
    ready_time: Optional[datetime] = None
    readers: int = 0
    bytes_received: int = 0
    bytes_sent: int = 0
    # Source connection info when available
    source_type: Optional[str] = None      # e.g. "srtConn", "rtmpConn"
    source_address: Optional[str] = None

    model_config = {"from_attributes": True}


class StatsSnapshot(BaseModel):
    """Point-in-time stats for one stream, enriched beyond raw MediaMTX data."""

    path: str
    timestamp: datetime
    bitrate_kbps: float = 0.0
    rtt_ms: float = 0.0
    packet_loss_pct: float = 0.0
    readers: int = 0
    bytes_received: int = 0
    bytes_sent: int = 0
