"""Customer emails."""


def send_email(to: str, subject: str, body: str) -> None:
    print(f"to={to} subject={subject}\n{body}")


def send_receipt(order: dict) -> None:
    total = order["totals"]["total"] / 100
    send_email(order["email"], f"Order {order['id']} confirmed", f"You paid ${total:.2f}.")
