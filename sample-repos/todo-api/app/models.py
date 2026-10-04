"""Request and response shapes."""

from dataclasses import dataclass


@dataclass
class TodoIn:
    title: str
    done: bool = False


@dataclass
class Credentials:
    email: str
    password: str


def todo_out(row: dict) -> dict:
    return {"id": row["id"], "title": row["title"], "done": row["done"]}
