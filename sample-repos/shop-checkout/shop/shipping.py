"""Shipping cost from cart weight."""

FREE_OVER = 5000


def shipping_cost(weight_grams: int, subtotal: int) -> int:
    if subtotal >= FREE_OVER:
        return 0
    return 400 + (weight_grams // 500) * 150
