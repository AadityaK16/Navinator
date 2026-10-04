"""A fake card gateway."""

import uuid


class PaymentDeclined(Exception):
    pass


def charge_card(card_number: str, amount: int) -> str:
    if card_number.endswith("0000"):
        raise PaymentDeclined("card declined")
    return f"ch_{uuid.uuid4().hex[:12]}"


def refund(charge_id: str) -> None:
    print(f"refunded {charge_id}")
