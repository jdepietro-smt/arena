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
    MEDIAMTX_SRT_PORT: int = 8892  # 8890 is now the FFmpeg PCM->AAC relay input

    # JWT / Auth
    SECRET_KEY: str = "arena-secret-change-in-prod"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # Database
    DATABASE_URL: str = "sqlite:///./arena.db"

    # Network
    SERVER_IP: str = "5.78.236.254"
    ARENA_PORT: int = 8001


settings = Settings()
