from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # MediaMTX endpoints
    MEDIAMTX_API: str = "http://localhost:9997"
    MEDIAMTX_HLS: str = "http://localhost:8888"
    MEDIAMTX_WEBRTC: str = "http://localhost:8889"
    MEDIAMTX_SRT_PORT: int = 8890  # mediamtx SRT port; relay ingests on 8895

    # SRT publish auth — without this, mediamtx's SRT listener accepts a
    # publish under any streamid from anyone who reaches the port at all
    # (confirmed live: an unrelated stream showed up under a name nobody on
    # the team recognized). Set via .env; must be 10-79 chars per the SRT
    # spec. Left blank leaves publish wide open — startup logs a warning in
    # that case rather than silently doing nothing.
    SRT_PUBLISH_PASSPHRASE: str = ""

    # JWT / Auth
    SECRET_KEY: str = "arena-secret-change-in-prod"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # Database
    DATABASE_URL: str = "sqlite:///./arena.db"

    # Network
    SERVER_IP: str = "5.78.236.254"
    ARENA_PORT: int = 8001

    # CORS — the dashboard is normally served by this same app (main.py's
    # StaticFiles mount), so browser requests are same-origin and don't need
    # CORS at all. This only matters for a separately-hosted frontend (e.g.
    # the Vite dev server on 5173 hitting a production API). Comma-separated;
    # never combine a wildcard with allow_credentials=True (see main.py).
    CORS_ORIGINS: str = "http://localhost:5173"

    # Alerting — a webhook (Slack-compatible {"text": "..."} payload) fired
    # on stream-down/recovered and on AlertRule threshold breaches/recovery.
    # Left blank, alerts are still logged (visible via journalctl) but
    # nothing gets pushed out — no one finds out about a problem unless
    # they're already looking.
    ALERT_WEBHOOK_URL: str = ""


settings = Settings()

# Exposed so main.py can warn at startup if .env never overrode it — every
# unconfigured deployment would otherwise share this same publicly-visible
# key, letting anyone forge an admin JWT without ever authenticating.
DEFAULT_SECRET_KEY = "arena-secret-change-in-prod"
