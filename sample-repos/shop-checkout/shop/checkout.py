"""Checkout: price, reserve stock, charge, save, and email."""

from .cart import Cart
from .inventory import release, reserve
from .notify import send_receipt
from .orders import save_order
from .payments.fraud import looks_risky
from .payments.gateway import charge_card
from .pricing import quote


class CheckoutError(Exception):
    pass


def checkout(cart: Cart, email: str, card_number: str, code: str | None = None) -> dict:
    if not cart.lines:
        raise CheckoutError("cart is empty")
    totals = quote(cart, code)
    if looks_risky(totals["total"], email):
        raise CheckoutError("order held for review")
    reserve(cart.lines)
    try:
        charge_id = charge_card(card_number, totals["total"])
    except Exception:
        release(cart.lines)
        raise
    order = save_order(email, cart.lines, totals, charge_id)
    send_receipt(order)
    return order


def main() -> None:
    cart = Cart()
    cart.add("mug", 2)
    cart.add("tee")
    print(checkout(cart, "sam@shop.test", "4242424242424242", "WELCOME10"))


if __name__ == "__main__":
    main()
