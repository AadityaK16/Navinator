"""Turn a cart into a priced quote."""

from .cart import Cart
from .discounts import discount_for
from .shipping import shipping_cost

TAX_RATE = 8


def tax_on(amount: int) -> int:
    return amount * TAX_RATE // 100


def quote(cart: Cart, code: str | None = None) -> dict:
    subtotal = cart.subtotal()
    discount = discount_for(code, subtotal)
    shipping = shipping_cost(cart.weight(), subtotal - discount)
    tax = tax_on(subtotal - discount)
    return {
        "subtotal": subtotal,
        "discount": discount,
        "shipping": shipping,
        "tax": tax,
        "total": subtotal - discount + shipping + tax,
    }
