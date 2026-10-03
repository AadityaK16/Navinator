"""Concept map over the code graph. Code relations are checked against parsed edges; the rest are labeled conceptual."""

import json
from pathlib import Path

from .graph import DATA, GRAPH, NODES, evidence_for

KINDS = ("architecture", "concept", "function", "decision", "topic")
RELATIONS = ("depends_on", "implements", "related_to", "explains", "calls_into", "part_of")
# A code relation that the parsed graph cannot confirm is rejected, never shown as conceptual.
CODE_RELATIONS = ("calls_into", "part_of")

EDGES = {(link["source"], link["target"], link["type"]): link for link in GRAPH["links"]}


def _files(node: dict) -> list[str]:
    return [ref for ref in node["code_refs"] if NODES[ref]["type"] == "file"]


def _code_edge(src: dict, dst: dict, relation: str) -> dict | None:
    """Return the parsed edge that backs this relation, if there is one."""
    pairs: list[tuple[str, str, str]] = []
    if src["kind"] == "function" and dst["kind"] == "function" and src["code_refs"] and dst["code_refs"]:
        kind = {"calls_into": "calls", "depends_on": "depends"}.get(relation)
        if kind:
            pairs.append((src["code_refs"][0], dst["code_refs"][0], kind))
    if relation == "depends_on" and src["kind"] == "architecture" and dst["kind"] == "architecture":
        pairs += [(a, b, "imports") for a in _files(src) for b in _files(dst)]
    if relation == "part_of" and src["kind"] == "function" and dst["kind"] == "architecture" and src["code_refs"]:
        pairs += [(f, src["code_refs"][0], "contains") for f in _files(dst)]
    for pair in pairs:
        if pair in EDGES:
            return EDGES[pair]
    return None


def build_knowledge(raw: dict) -> dict:
    nodes = []
    by_id = {}
    rejected = []
    for item in raw["nodes"]:
        refs = [ref for ref in item.get("code_refs", []) if ref in NODES]
        for ref in item.get("code_refs", []):
            if ref not in NODES:
                rejected.append({"id": item["id"], "reason": f"unknown code ref {ref}"})
        node = {
            "id": item["id"],
            "kind": item["kind"],
            "title": item["title"],
            "summary": item["summary"],
            "cluster": item["cluster"],
            "code_refs": refs,
            "origin": item.get("origin", "curated"),
        }
        by_id[node["id"]] = node
        nodes.append(node)

    links = []
    for item in raw["links"]:
        src, dst = by_id.get(item["source"]), by_id.get(item["target"])
        relation = item["relation"]
        if not src or not dst or relation not in RELATIONS:
            rejected.append({"id": f"{item['source']}->{item['target']}", "reason": "unknown node or relation"})
            continue
        edge = _code_edge(src, dst, relation)
        if relation in CODE_RELATIONS and edge is None:
            rejected.append({"id": f"{src['id']}->{dst['id']}", "reason": f"{relation} not found in the call graph"})
            continue
        evidence = None
        if edge:
            # imports and contains edges carry no line, so name the modules instead.
            evidence = (
                evidence_for(edge["source"], edge["target"], edge)
                if edge.get("line")
                else f"{edge['type']}: {edge['source']} → {edge['target']}"
            )
        links.append({
            "source": src["id"],
            "target": dst["id"],
            "relation": relation,
            "verified": edge is not None,
            "evidence": evidence,
            "note": item.get("note", ""),
            "origin": item.get("origin", "curated"),
        })
    return {"clusters": raw["clusters"], "nodes": nodes, "links": links, "rejected": rejected}


def load_knowledge(path: Path = DATA / "knowledge.json") -> dict:
    return build_knowledge(json.loads(path.read_text()))
