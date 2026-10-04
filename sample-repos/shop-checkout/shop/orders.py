"""Saved orders."""

ORDERS: list[dict] = []


def save_order(email: str, lines: dict[str, int], totals: dict, charge_id: str) -> dict:
    order = {"id": len(ORDERS) + 1, "email": email, "lines": dict(lines), "totals": totals, "charge": charge_id}
    ORDERS.append(order)
    return order
