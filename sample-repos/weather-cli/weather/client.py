"""Talk to the forecast API."""

import json
import urllib.parse
import urllib.request

from .cache import read_cache, write_cache

GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


def get_json(url: str, params: dict) -> dict:
    with urllib.request.urlopen(f"{url}?{urllib.parse.urlencode(params)}", timeout=10) as response:
        return json.load(response)


def geocode(city: str) -> tuple[float, float]:
    data = get_json(GEO_URL, {"name": city, "count": 1})
    if not data.get("results"):
        raise LookupError(f"no place called {city}")
    place = data["results"][0]
    return place["latitude"], place["longitude"]


def fetch_forecast(city: str) -> dict:
    cached = read_cache(city)
    if cached:
        return cached
    lat, lon = geocode(city)
    data = get_json(FORECAST_URL, {"latitude": lat, "longitude": lon, "daily": "temperature_2m_max,wind_speed_10m_max"})
    write_cache(city, data)
    return data
