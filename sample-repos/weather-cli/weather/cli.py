"""weather <city> [--days N] [--imperial]"""

import argparse

from .forecast import forecast_for
from .render import render_table


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="weather")
    parser.add_argument("city")
    parser.add_argument("--days", type=int, default=5)
    parser.add_argument("--imperial", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        readings = forecast_for(args.city, args.days, args.imperial)
    except LookupError as exc:
        print(exc)
        return 1
    print(render_table(args.city, readings, args.imperial))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
