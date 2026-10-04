"""Stock levels and reservations."""

STOCK = {"mug": 20, "tee": 5, "poster": 0}


class OutOfStock(Exception):
    pass


def check_stock(lines: dict[str, int]) -> None:
    for sku, qty in lines.items():
        if STOCK.get(sku, 0) < qty:
            raise OutOfStock(sku)


def reserve(lines: dict[str, int]) -> None:
    check_stock(lines)
    for sku, qty in lines.items():
        STOCK[sku] -= qty


def release(lines: dict[str, int]) -> None:
    for sku, qty in lines.items():
        STOCK[sku] = STOCK.get(sku, 0) + qty
