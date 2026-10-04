"""Todo endpoints. Each one needs a signed-in user."""

from fastapi import APIRouter

from ..deps import CurrentUser, SessionDep
from ..models import TodoIn
from ..services import todos

router = APIRouter(prefix="/todos")


@router.get("/")
def read_todos(user: CurrentUser, session: SessionDep) -> list[dict]:
    return todos.list_todos(session, user["id"])


@router.post("/")
def add_todo(body: TodoIn, user: CurrentUser, session: SessionDep) -> dict:
    return todos.create_todo(session, user["id"], body)


@router.post("/{todo_id}/done")
def finish_todo(todo_id: int, user: CurrentUser, session: SessionDep) -> dict:
    return todos.complete_todo(session, user["id"], todo_id)


@router.delete("/{todo_id}")
def remove_todo(todo_id: int, user: CurrentUser, session: SessionDep) -> dict:
    todos.delete_todo(session, user["id"], todo_id)
    return {"ok": True}
