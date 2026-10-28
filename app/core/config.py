"""Minimal configuration; unsupported deployment/control modes fail closed."""
from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    environment: str = "development"
    device_mode: str = "simulator"

    def __post_init__(self):
        if self.environment not in {"development", "test"}:
            raise ValueError("This scaffold only supports local development and test environments.")
        if self.device_mode != "simulator":
            raise ValueError("Real device control is not implemented; use simulator mode.")


def load_settings() -> Settings:
    return Settings(
        environment=os.getenv("SATINLORE_ENV", "development"),
        device_mode=os.getenv("SATINLORE_DEVICE_MODE", "simulator"),
    )
