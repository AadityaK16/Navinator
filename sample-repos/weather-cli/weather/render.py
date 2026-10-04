"""Print readings as a small table."""


def bar(value: float, scale: float = 2.0) -> str:
    return "#" * max(0, int(value / scale))


def render_table(city: str, readings: list[dict], imperial: bool) -> str:
    unit = "F" if imperial else "C"
    rows = [f"Forecast for {city}"]
    for r in readings:
        rows.append(f"{r['date']}  {r['temp']:5.1f}{unit}  {bar(r['temp'])}")
    return "\n".join(rows)
