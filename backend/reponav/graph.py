"""Load the call graph and answer search, trace, and blast queries.

Only calls and depends edges are traversable. The agent names waypoints;
shortest paths and evidence come from this graph, not from the model.
"""

import json
import math
import os
import re
from pathlib import Path

import networkx as nx
from dotenv import load_dotenv
from rank_bm25 import BM25Okapi

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")
DATA = BACKEND_DIR / "data"
_repo = Path(os.environ.get("REPO_ROOT", "../demo-repo/backend"))
REPO_ROOT = _repo if _repo.is_absolute() else (BACKEND_DIR / _repo).resolve()

GRAPH = json.loads((DATA / "graph.json").read_text())
NODES = {n["id"]: n for n in GRAPH["nodes"]}
G = nx.DiGraph()
for link in GRAPH["links"]:
    if link["type"] in ("calls", "depends"):
        G.add_edge(link["source"], link["target"], **link)


def node_source(nid: str) -> str:
    n = NODES[nid]
    if n["type"] == "external" or not n.get("file_path"):
        return ""
    path = REPO_ROOT / n["file_path"]
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8", errors="ignore")


def evidence_for(src_id: str, dst_id: str, edge: dict) -> str:
    kind = edge.get("type") or "calls"
    line = edge.get("line")
    src = NODES.get(src_id) or {}
    dst = NODES.get(dst_id) or {}
    if line and src.get("file_path"):
        return f"{kind} at {src['file_path']}:{line}"
    if line and dst.get("file_path"):
        return f"{kind} at {dst['file_path']}:{line}"
    return kind


def _tokens(text: str) -> list[str]:
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    return [t for t in re.split(r"[^a-zA-Z0-9]+", text.lower()) if len(t) > 1]


SEARCHABLE = [
    n for n in GRAPH["nodes"] if n["type"] in ("function", "method", "class", "external")
]
_src_cache: dict[str, list[str]] = {}


def _snippet(n: dict) -> str:
    if n["type"] == "external":
        return n["label"]
    lines = _src_cache.setdefault(n["file_path"], node_source(n["id"]).splitlines())
    start = max((n["line_start"] or 1) - 1, 0)
    return "\n".join(lines[start : (n["line_start"] or 1) + 39])


BM25 = BM25Okapi([_tokens(f"{n['id']} {n['doc']} {_snippet(n)}") for n in SEARCHABLE])


def search_codebase(query: str, k: int = 8) -> list[dict]:
    tokens = _tokens(query)
    if not tokens:
        return []
    scores = BM25.get_scores(tokens)
    ranked = sorted(zip(scores, SEARCHABLE), key=lambda item: -float(item[0]))[:k]
    hits = []
    for score, n in ranked:
        score = float(score)
        if score <= 0:
            continue
        nid = n["id"]
        hits.append(
            {
                "id": nid,
                "type": n["type"],
                "file": n["file_path"],
                "score": round(score, 2),
                "calls": list(G.successors(nid))[:6] if nid in G else [],
            }
        )
    return hits


def read_node(node_id: str) -> dict:
    n = NODES.get(node_id)
    if not n:
        return {"error": f"unknown node {node_id}"}
    return {
        "id": node_id,
        "file": n["file_path"],
        "source": _snippet(n),
        "calls": list(G.successors(node_id)) if node_id in G else [],
        "called_by": list(G.predecessors(node_id)) if node_id in G else [],
    }


def trace_path(waypoints: list[str]) -> dict:
    if not isinstance(waypoints, list) or not waypoints:
        return {
            "error": "waypoints must be a non-empty list. Use search_codebase or read_node to find real ids."
        }
    bad = [w for w in waypoints if w not in G]
    if bad:
        return {
            "error": f"not in call graph: {bad}. Use search_codebase or read_node to find real ids."
        }
    path = [waypoints[0]]
    for a, b in zip(waypoints, waypoints[1:]):
        try:
            hop = nx.shortest_path(G, a, b)
        except nx.NetworkXNoPath:
            return {
                "error": f"no call path from {a} to {b}. Pick a different waypoint or reorder."
            }
        path += hop[1:]
    hops = []
    for a, b in zip(path, path[1:]):
        edge = G.edges[a, b]
        hops.append(
            {
                "from": a,
                "to": b,
                "type": edge["type"],
                "evidence": evidence_for(a, b, edge),
            }
        )
    return {"path": path, "hops": hops}


def blast_radius(node_id: str, depth: int = 3) -> list[dict]:
    if node_id not in G:
        return []
    seen = {node_id: 0}
    frontier = [node_id]
    for dist in range(1, depth + 1):
        nxt = []
        for node in frontier:
            for pred in G.predecessors(node):
                if pred not in seen:
                    seen[pred] = dist
                    nxt.append(pred)
        frontier = nxt
    return [{"id": nid, "distance": dist} for nid, dist in seen.items() if dist > 0]


def seed_layout(nodes: list[dict] | None = None) -> dict:
    """Stable cluster layout so the first load does not depend on a live simulation."""
    nodes = list(nodes or GRAPH["nodes"])
    groups: dict[str, list[dict]] = {}
    for n in nodes:
        groups.setdefault(n.get("cluster") or "app", []).append(n)
    names = sorted(groups)
    placed = []
    for i, name in enumerate(names):
        angle = 2 * math.pi * i / max(len(names), 1)
        cx = math.cos(angle) * 220
        cy = math.sin(angle) * 220
        group = sorted(groups[name], key=lambda n: (n["type"], n["id"]))
        cols = max(1, math.ceil(math.sqrt(len(group))))
        for j, n in enumerate(group):
            col = j % cols
            row = j // cols
            z = {"file": 48, "class": 24, "external": 72}.get(n["type"], 0)
            placed.append(
                {
                    "id": n["id"],
                    "x": round(cx + (col - cols / 2) * 36, 2),
                    "y": round(cy + (row - len(group) / cols / 2) * 36, 2),
                    "z": z,
                }
            )
    return {"nodes": placed}
