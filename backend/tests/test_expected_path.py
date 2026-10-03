import json
from pathlib import Path

from reponav.graph import DATA, NODES

GRAPH = json.loads((DATA / "graph.json").read_text())
EDGES = {(link["source"], link["target"], link["type"]): link for link in GRAPH["links"]}


def test_expected_path_edges_exist():
    lines = (DATA / "expected_path.txt").read_text().splitlines()
    assert lines, "expected_path.txt is empty"
    for line in lines:
        if not line.strip():
            continue
        src, arrow, tgt, kind, loc = line.split()
        assert arrow == "->"
        edge = EDGES.get((src, tgt, kind))
        assert edge, f"missing {kind} edge {src} -> {tgt}"
        file, lineno = loc.split(":")
        assert edge["line"] == int(lineno)
        if edge["confidence"] == "manual":
            assert NODES[tgt]["file_path"] == file
        else:
            assert NODES[src]["file_path"] == file
