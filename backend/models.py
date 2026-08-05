from __future__ import annotations

import enum
from datetime import datetime
from typing import Annotated, Any, List, Optional

from pydantic import BaseModel, StringConstraints
from sqlalchemy import UniqueConstraint
from sqlmodel import Column, Field, JSON, SQLModel

# A basic x@y.z shape check — deliberately NOT pydantic's EmailStr, which
# also enforces real-world deliverability (rejects reserved/special-use
# TLDs like .local, .internal, .test). Confirmed live: that rejected the
# seeded default admin's own address (admin@arena.local) the moment an
# admin tried to register a second user with a similarly internal
# address. Nothing in this app ever sends mail to this field — it's a
# unique identifier, not a delivery target — so deliverability isn't a
# real constraint here, only the SQL uniqueness on User.email.
#
# Applied via Annotated/StringConstraints rather than sqlmodel's Field
# (`Field(pattern=...)`) — sqlmodel 0.0.21's Field wrapper doesn't forward
# `pattern` to pydantic, so that raised a bare TypeError at class-definition
# time instead of actually validating anything.
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
EmailShape = Annotated[str, StringConstraints(pattern=EMAIL_PATTERN)]


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


class ManagedPathType(str, enum.Enum):
    composite = "composite"
    external_source = "external_source"


class EventType(str, enum.Enum):
    stream_connected = "stream_connected"
    stream_disconnected = "stream_disconnected"
    recording_started = "recording_started"
    recording_stopped = "recording_stopped"
    alert_fired = "alert_fired"
    alert_recovered = "alert_recovered"
    predicted_risk = "predicted_risk"
    predicted_risk_cleared = "predicted_risk_cleared"
    qc_issue_detected = "qc_issue_detected"
    qc_issue_cleared = "qc_issue_cleared"
    route_failed_over = "route_failed_over"
    route_failed_back = "route_failed_back"


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
    # Nullable — never logged in yet, or logged in before this column
    # existed on an already-deployed DB (see database.py's
    # _ensure_users_last_login_column, since create_all() never alters an
    # existing table to add a column).
    last_login: Optional[datetime] = Field(default=None)


class StreamRoute(SQLModel, table=True):
    __tablename__ = "stream_routes"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True, min_length=1, max_length=128)
    source_path: str = Field(description="MediaMTX path that is the source")
    # JSON list of dicts: [{"type": "srt|hls|rtmp|record", "url": "..."}, ...]
    destinations: List[Any] = Field(default_factory=list, sa_column=Column(JSON))
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # Automatic failover target — see services/route_failover.py. None means
    # this route has no configured backup and never fails over.
    backup_source_path: Optional[str] = Field(default=None)
    # True while relaying from backup_source_path instead of source_path.
    # Failback is deliberately manual (PUT /{id}/fail-back) rather than
    # automatic on primary recovery — see route_failover.py's docstring for
    # why (flapping between two imperfect sources is worse than staying put).
    failed_over: bool = Field(default=False)


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


class RecordingConfig(SQLModel, table=True):
    """
    Singleton row (always id=1) backing the Settings page's Recording tab —
    that UI already existed with a "default output directory" field, a
    storage-limit slider, and an auto-delete toggle, but there was no
    /api/settings/recording endpoint behind it at all, so saving silently
    did nothing. This is that missing backing store.

    output_dir is read at recording-start time (services/recorder.py) and
    by the recordings router for file operations — both used to disagree
    on where recordings actually live (recorder.py hardcoded
    /opt/arena/recordings; the router read a settings.RECORDINGS_DIR that
    was never defined, silently falling back to a relative "./recordings").
    Routing both through get_recordings_dir() here fixes that mismatch.
    """

    __tablename__ = "recording_config"

    id: int = Field(default=1, primary_key=True)
    output_dir: str = Field(default="/opt/arena/recordings")
    max_storage_gb: float = Field(default=500.0)
    auto_delete: bool = Field(default=False)


class RedundancyGateway(SQLModel, table=True):
    """
    A configured sdi_receive instance (SMPTE 2022-7 protection-switch
    gateway) to poll for path1/path2/output health.

    sdi_receive runs standalone, typically near the decode/playout box, not
    spawned or managed by this backend — this row just records where its
    --stats-port endpoint is so RedundancyMonitor (services/redundancy.py)
    can poll it and surface path-down alerts the same way stream connectivity
    already is.
    """

    __tablename__ = "redundancy_gateways"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True, min_length=1, max_length=128)
    stats_url: str = Field(min_length=1)   # e.g. http://10.0.1.5:6400/
    stream_path: Optional[str] = Field(default=None, index=True)  # for correlating with a stream in the UI
    is_active: bool = Field(default=True)


class Event(SQLModel, table=True):
    """
    A row per stream connect/disconnect, recording start/stop, or alert
    transition — backs the dashboard's "Recent Events" sidebar, which
    previously showed a hardcoded MOCK_EVENTS array with no data behind it.

    Written directly at the point of detection (alerting.py's connectivity/
    rule-transition checks, recorder.py's start/stop) rather than derived by
    polling some other table, since those call sites already have clean
    structured data before it would otherwise be flattened into a log line.
    """

    __tablename__ = "events"

    id: Optional[int] = Field(default=None, primary_key=True)
    type: EventType = Field(index=True)
    stream_path: Optional[str] = Field(default=None, index=True)
    message: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class AuditLogEntry(SQLModel, table=True):
    """
    A row per admin-facing mutation (user/route/alert-rule/gateway create
    or delete) — who did it and to what, for accountability on a
    multi-operator team. Separate from Event: Event is system-observed
    state transitions (a stream went down); this is human-initiated
    actions, which is a different question ("who deleted this route?")
    that Event was never meant to answer.

    Written best-effort from the mutating endpoint itself, wrapped in
    try/except by log_audit() — a logging failure must never block the
    action it's describing.
    """

    __tablename__ = "audit_log"

    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True)
    action: str = Field(index=True)  # e.g. "user.create", "route.delete"
    target: Optional[str] = Field(default=None)  # human-readable identifier of what was acted on
    detail: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class FavoriteStream(SQLModel, table=True):
    """
    A user's pinned streams — quick access when managing many at once.
    Per-user (not global) since what one operator cares about isn't
    necessarily what another does. New table rather than a JSON column on
    User: avoids the create_all()-never-alters-a-table trap that
    User.last_login already needed a manual migration for.
    """

    __tablename__ = "favorite_streams"
    __table_args__ = (UniqueConstraint("user_id", "stream_path", name="uq_favorite_user_stream"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    stream_path: str = Field(index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class StreamUptimeDaily(SQLModel, table=True):
    """
    Per-day, per-stream uptime sample counts, fed by AlertManager's existing
    10s connectivity poll (alerting.py's _check_connectivity) — every tick
    that already checks whether a path is ready also counts as one uptime
    sample, so this adds no new polling of its own.

    The Event table (events.py) is a 500-row ring buffer sized for a
    dashboard sidebar, not a historical record — it can churn through its
    entire retention in hours on a busy deployment. This table is the
    durable one: percentages here only ever accumulate, never get pruned.

    up_samples / total_samples rather than a raw percentage: storing counts
    lets a day's percentage be corrected/recomputed if needed, and makes
    "how many samples is this based on" inspectable rather than opaque.
    """

    __tablename__ = "stream_uptime_daily"
    __table_args__ = (UniqueConstraint("date", "stream_path", name="uq_uptime_date_stream"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    date: str = Field(index=True)  # "YYYY-MM-DD", UTC
    stream_path: str = Field(index=True)
    up_samples: int = Field(default=0)
    total_samples: int = Field(default=0)


class ManagedPath(SQLModel, table=True):
    """
    A mediamtx path this app created and is responsible for tearing down.

    Registered when a compositor job or external source successfully calls
    add_path, and unregistered when it's cleanly removed. Rows still present
    at startup are orphans from a process that restarted without a clean
    shutdown — the reconciliation step in main.py's lifespan handler removes
    both the mediamtx path and the row.
    """

    __tablename__ = "managed_paths"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True, min_length=1, max_length=128)
    path_type: ManagedPathType
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------------
# Pydantic request / response schemas  (not DB tables)
# ---------------------------------------------------------------------------


class UserCreate(BaseModel):
    username: str
    email: EmailShape
    password: str
    role: UserRole = UserRole.viewer


class UserRead(BaseModel):
    id: int
    username: str
    email: str
    role: UserRole
    is_active: bool
    created_at: datetime
    last_login: Optional[datetime] = None

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
    backup_source_path: Optional[str] = None


class RouteRead(BaseModel):
    id: int
    name: str
    source_path: str
    destinations: List[Any]
    is_active: bool
    created_at: datetime
    backup_source_path: Optional[str] = None
    failed_over: bool = False

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


class EventRead(BaseModel):
    id: int
    type: EventType
    stream_path: Optional[str]
    message: Optional[str]
    created_at: datetime

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
