"""Unit conversion."""


def c_to_f(celsius: float) -> float:
    return celsius * 9 / 5 + 32


def kmh_to_mph(kmh: float) -> float:
    return kmh * 0.621371


def convert(reading: dict, imperial: bool) -> dict:
    if not imperial:
        return reading
    return {**reading, "temp": c_to_f(reading["temp"]), "wind": kmh_to_mph(reading["wind"])}
