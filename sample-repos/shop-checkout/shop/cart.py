"""A shopping cart: SKUs and quantities."""

from .catalog import lookup


class Cart:
    def __init__(self) -> None:
        self.lines: dict[str, int] = {}

    def add(self, sku: str, qty: int = 1) -> None:
        lookup(sku)
        self.lines[sku] = self.lines.get(sku, 0) + qty

    def remove(self, sku: str) -> None:
        self.lines.pop(sku, None)

    def subtotal(self) -> int:
        return sum(lookup(sku)["price"] * qty for sku, qty in self.lines.items())

    def weight(self) -> int:
        return sum(lookup(sku)["weight"] * qty for sku, qty in self.lines.items())
