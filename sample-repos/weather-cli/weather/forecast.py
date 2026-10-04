"""Shape raw API data into daily readings."""

from .client import fetch_forecast
from .units import convert


def daily_readings(raw: dict) -> list[dict]:
    daily = raw["daily"]
    return [
        {"date": date, "temp": temp, "wind": wind}
        for date, temp, wind in zip(daily["time"], daily["temperature_2m_max"], daily["wind_speed_10m_max"])
    ]


def forecast_for(city: str, days: int, imperial: bool) -> list[dict]:
    readings = daily_readings(fetch_forecast(city))[:days]
    return [convert(r, imperial) for r in readings]
