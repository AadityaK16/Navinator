"""Discount codes."""

CODES = {"WELCOME10": ("percent", 10), "FIVEOFF": ("fixed", 500)}


def discount_for(code: str | None, subtotal: int) -> int:
    if not code or code not in CODES:
        return 0
    kind, amount = CODES[code]
    if kind == "percent":
        return subtotal * amount // 100
    return min(amount, subtotal)
