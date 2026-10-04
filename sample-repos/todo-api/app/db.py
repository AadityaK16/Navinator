"""A tiny in-memory store that stands in for a database session."""

from collections.abc import Iterator


class Session:
    def __init__(self) -> None:
        self.rows: dict[str, dict[int, dict]] = {"users": {}, "todos": {}}
        self.next_id = 1

    def insert(self, table: str, row: dict) -> dict:
        row = {**row, "id": self.next_id}
        self.rows[table][self.next_id] = row
        self.next_id += 1
        return row

    def get(self, table: str, row_id: int) -> dict | None:
        return self.rows[table].get(row_id)

    def find(self, table: str, **match) -> list[dict]:
        return [r for r in self.rows[table].values() if all(r.get(k) == v for k, v in match.items())]

    def delete(self, table: str, row_id: int) -> None:
        self.rows[table].pop(row_id, None)


_session = Session()


def get_session() -> Iterator[Session]:
    yield _session
