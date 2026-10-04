"""Shared FastAPI dependencies: the session and the signed-in user."""

from typing import Annotated

from fastapi import Depends, Header, HTTPException

from .db import Session, get_session
from .security import read_token

SessionDep = Annotated[Session, Depends(get_session)]


def get_current_user(session: SessionDep, authorization: str = Header("")) -> dict:
    token = authorization.removeprefix("Bearer ").strip()
    user_id = read_token(token)
    user = session.get("users", user_id) if user_id else None
    if not user:
        raise HTTPException(status_code=401, detail="Not signed in")
    return user


CurrentUser = Annotated[dict, Depends(get_current_user)]
