"""Password hashing and signed tokens."""

import hashlib
import hmac

SECRET = b"change-me"


def hash_password(password: str) -> str:
    return hashlib.sha256(SECRET + password.encode()).hexdigest()


def verify_password(password: str, hashed: str) -> bool:
    return hmac.compare_digest(hash_password(password), hashed)


def create_token(user_id: int) -> str:
    sig = hmac.new(SECRET, str(user_id).encode(), hashlib.sha256).hexdigest()
    return f"{user_id}.{sig}"


def read_token(token: str) -> int | None:
    user_id, _, sig = token.partition(".")
    if not user_id.isdigit():
        return None
    expected = create_token(int(user_id)).partition(".")[2]
    return int(user_id) if hmac.compare_digest(sig, expected) else None
