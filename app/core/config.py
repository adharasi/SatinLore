"""Local development settings. Hardware mode requires explicit server configuration."""
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit
import os

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / "app" / "static"


@dataclass(frozen=True)
class Settings:
    environment: str = "development"
    device_mode: str = "simulator"
    app_origin: str = "http://127.0.0.1:8000"
    database_path: Path = ROOT / "data" / "satinlore.sqlite3"
    session_ttl_seconds: int = 3600
    lovense_developer_token: str = field(default="", repr=False)
    lovense_platform_name: str = ""

    def __post_init__(self):
        if self.environment not in {"development", "test"}:
            raise ValueError("Only local development and test environments are supported.")
        if self.device_mode not in {"simulator", "lovense"}:
            raise ValueError("Unknown device mode; use simulator or lovense.")
        origin = urlsplit(self.app_origin)
        try:
            port = origin.port
        except ValueError:
            raise ValueError("APP_ORIGIN has an invalid port.") from None
        if port == 0:
            raise ValueError("APP_ORIGIN has an invalid port.")
        if (origin.scheme not in {"http", "https"} or origin.hostname not in
                {"localhost", "127.0.0.1", "::1", "testserver"} or origin.username or
                origin.password or origin.path or origin.query or origin.fragment):
            raise ValueError("APP_ORIGIN must be an exact local HTTP(S) origin without a trailing slash.")
        if origin.hostname == "testserver" and self.environment != "test":
            raise ValueError("testserver is reserved for tests.")
        if not 60 <= self.session_ttl_seconds <= 86400:
            raise ValueError("Session TTL must be between 60 and 86400 seconds.")
        database_path = Path(self.database_path).expanduser().resolve()
        if database_path == STATIC or STATIC in database_path.parents:
            raise ValueError("The database must be outside the public static directory.")
        object.__setattr__(self, "database_path", database_path)
        if self.device_mode == "lovense" and not (
            self.lovense_developer_token.strip() and self.lovense_platform_name.strip()
        ):
            raise ValueError("Lovense mode requires server-side developer token and platform name.")

    @property
    def secure_cookie(self) -> bool:
        return self.app_origin.startswith("https://")


def load_settings() -> Settings:
    return Settings(
        environment=os.getenv("SATINLORE_ENV", "development"),
        device_mode=os.getenv("SATINLORE_DEVICE_MODE", "simulator"),
        app_origin=os.getenv("SATINLORE_APP_ORIGIN", "http://127.0.0.1:8000"),
        database_path=Path(os.getenv("SATINLORE_DATABASE_PATH", str(ROOT / "data" / "satinlore.sqlite3"))),
        session_ttl_seconds=int(os.getenv("SATINLORE_SESSION_TTL_SECONDS", "3600")),
        lovense_developer_token=os.getenv("LOVENSE_DEVELOPER_TOKEN", ""),
        lovense_platform_name=os.getenv("LOVENSE_PLATFORM_NAME", ""),
    )
