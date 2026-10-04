"""Todo rules, kept out of the route handlers."""

from fastapi import HTTPException

from ..db import Session
from ..models import TodoIn, todo_out


def list_todos(session: Session, owner_id: int) -> list[dict]:
    return [todo_out(row) for row in session.find("todos", owner_id=owner_id)]


def create_todo(session: Session, owner_id: int, todo: TodoIn) -> dict:
    title = todo.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="A todo needs a title")
    row = session.insert("todos", {"title": title, "done": todo.done, "owner_id": owner_id})
    return todo_out(row)


def get_owned(session: Session, owner_id: int, todo_id: int) -> dict:
    row = session.get("todos", todo_id)
    if not row or row["owner_id"] != owner_id:
        raise HTTPException(status_code=404, detail="Todo not found")
    return row


def complete_todo(session: Session, owner_id: int, todo_id: int) -> dict:
    row = get_owned(session, owner_id, todo_id)
    row["done"] = True
    return todo_out(row)


def delete_todo(session: Session, owner_id: int, todo_id: int) -> None:
    row = get_owned(session, owner_id, todo_id)
    session.delete("todos", row["id"])
