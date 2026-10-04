"""Very simple fraud rules."""

LIMIT = 100_000


def looks_risky(amount: int, email: str) -> bool:
    return amount > LIMIT or email.endswith("@example.invalid")
