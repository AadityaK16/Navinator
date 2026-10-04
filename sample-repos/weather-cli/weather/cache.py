"""A file cache so repeat lookups skip the network."""

import json
import time
from pathlib import Path

CACHE_DIR = Path.home() / ".cache" / "weather-cli"
TTL_SECONDS = 600


def cache_path(key: str) -> Path:
    return CACHE_DIR / f"{key.replace(' ', '_').lower()}.json"


def read_cache(key: str) -> dict | None:
    path = cache_path(key)
    if not path.exists() or time.time() - path.stat().st_mtime > TTL_SECONDS:
        return None
    return json.loads(path.read_text())


def write_cache(key: str, data: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path(key).write_text(json.dumps(data))
