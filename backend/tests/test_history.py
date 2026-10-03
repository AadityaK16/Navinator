import json

from reponav.graph import DATA


def test_history_ends_at_current_graph():
    history = json.loads((DATA / "history.json").read_text())
    graph = json.loads((DATA / "graph.json").read_text())
    current = {n["id"] for n in graph["nodes"] if n["type"] != "external"}
    assert set(history["born_at"]) == current


def test_history_snapshots_are_ordered_and_consistent():
    history = json.loads((DATA / "history.json").read_text())
    snaps = history["snapshots"]
    assert len(snaps) > 10
    dates = [s["date"] for s in snaps]
    assert dates == sorted(dates)
    alive: set[str] = set()
    for snap in snaps:
        alive -= set(snap["removed"])
        alive |= set(snap["added"])
        assert len(alive) == snap["nodes"]
    for index in history["born_at"].values():
        assert 0 <= index < len(snaps)
