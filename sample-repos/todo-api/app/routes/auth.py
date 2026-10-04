"""Sign up and log in."""

from fastapi import APIRouter, HTTPException

from ..deps import SessionDep
from ..models import Credentials
from ..security import create_token, hash_password, verify_password

router = APIRouter(prefix="/auth")


@router.post("/signup")
def signup(body: Credentials, session: SessionDep) -> dict:
    if session.find("users", email=body.email):
        raise HTTPException(status_code=409, detail="Email already registered")
    user = session.insert("users", {"email": body.email, "password": hash_password(body.password)})
    return {"token": create_token(user["id"])}


def authenticate(session, email: str, password: str) -> dict | None:
    users = session.find("users", email=email)
    if users and verify_password(password, users[0]["password"]):
        return users[0]
    return None


@router.post("/login")
def login(body: Credentials, session: SessionDep) -> dict:
    user = authenticate(session, body.email, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Wrong email or password")
    return {"token": create_token(user["id"])}
