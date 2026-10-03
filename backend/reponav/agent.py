"""Tool-calling loop. The model picks waypoints; the graph validates the tour."""

import asyncio
import json
import os

from .graph import G, evidence_for, read_node, search_codebase, trace_path

DEFAULT_MODEL = "claude-sonnet-4-5"
SYSTEM = """You guide a developer through a Python codebase as a tour.
Work in this order: search_codebase, read_node on promising hits, trace_path through 2-4 waypoints from the entry point to where the work ends, then present_tour.
Rules: only use node ids returned by tools. A tour has 3-7 stops, all on the traced path, in order. Each consecutive pair must be a direct edge on that path, with no skipped hops.
Each narration is at most 2 short sentences, spoken aloud: say what this code does and why we go next.
No markdown in narration."""

TOOLS = [
    {
        "name": "search_codebase",
        "description": "Keyword search over functions and classes.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    },
    {
        "name": "read_node",
        "description": "Source, callers and callees of one node.",
        "input_schema": {
            "type": "object",
            "properties": {"node_id": {"type": "string"}},
            "required": ["node_id"],
        },
    },
    {
        "name": "trace_path",
        "description": "Connect ordered waypoints with real call and depends edges.",
        "input_schema": {
            "type": "object",
            "properties": {
                "waypoints": {"type": "array", "items": {"type": "string"}}
            },
            "required": ["waypoints"],
        },
    },
    {
        "name": "present_tour",
        "description": "Final answer. Stops must be consecutive nodes of a traced path.",
        "input_schema": {
            "type": "object",
            "properties": {
                "stops": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "node_id": {"type": "string"},
                            "narration": {"type": "string"},
                        },
                        "required": ["node_id", "narration"],
                    },
                }
            },
            "required": ["stops"],
        },
    },
]

FUNCS = {
    "search_codebase": search_codebase,
    "read_node": read_node,
    "trace_path": trace_path,
}

_client = None


def get_client():
    global _client
    if _client is None:
        import anthropic

        # User-level keys (sk-ant-usr-...) are rejected unless the request names a workspace.
        workspace = os.environ.get("ANTHROPIC_WORKSPACE_ID")
        headers = {"anthropic-workspace-id": workspace} if workspace else None
        _client = anthropic.AsyncAnthropic(default_headers=headers)
    return _client


def validate_tour(stops, traced_path) -> str | None:
    if not traced_path:
        return "trace a path before presenting a tour"
    if not isinstance(stops, list):
        return "tour needs 3-7 stops"
    ids = []
    for stop in stops:
        if isinstance(stop, str):
            ids.append(stop)
        elif isinstance(stop, dict) and stop.get("node_id"):
            ids.append(stop["node_id"])
        else:
            return "tour needs 3-7 stops"
    if not 3 <= len(ids) <= 7:
        return "tour needs 3-7 stops"
    start = 0
    for index, nid in enumerate(ids):
        try:
            idx = traced_path.index(nid, start)
        except ValueError:
            return f"no edge on traced path for {nid}; stops must follow the traced path exactly"
        if index > 0 and idx != start:
            prev = ids[index - 1]
            return f"no edge {prev} -> {nid}; stops must follow the traced path exactly"
        if (
            index > 0
            and ids[index - 1] in G
            and nid in G
            and not G.has_edge(ids[index - 1], nid)
        ):
            return f"no edge {ids[index - 1]} -> {nid}; stops must follow the traced path exactly"
        start = idx + 1
    return None


def label(name: str, args: dict) -> str:
    if name == "search_codebase":
        return f"Searching: {args.get('query', '')}"
    if name == "read_node":
        node_id = str(args.get("node_id", ""))
        return f"Inspecting {node_id.split('.')[-1]}"
    if name == "trace_path":
        return "Tracing call path"
    return "Building tour"


def _enrich(stops: list[dict]) -> list[dict]:
    enriched = []
    for index, stop in enumerate(stops):
        evidence = "entry point"
        if index:
            prev = stops[index - 1]["node_id"]
            nid = stop["node_id"]
            evidence = evidence_for(prev, nid, G.edges[prev, nid])
        enriched.append(
            {
                "node_id": stop["node_id"],
                "narration": stop.get("narration") or "",
                "evidence": evidence,
            }
        )
    return enriched


async def run_agent(q: str):
    client = get_client()
    model = os.environ.get("MODEL") or DEFAULT_MODEL
    messages = [{"role": "user", "content": q}]
    traced = None
    for _ in range(8):
        resp = await asyncio.wait_for(
            client.messages.create(
                model=model,
                max_tokens=1500,
                system=SYSTEM,
                tools=TOOLS,
                messages=messages,
            ),
            timeout=15,
        )
        messages.append({"role": "assistant", "content": resp.content})
        if resp.stop_reason != "tool_use":
            break
        results = []
        for block in resp.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            args = block.input or {}
            yield {"type": "status", "message": label(block.name, args)}
            if block.name == "present_tour":
                stops = args.get("stops") or []
                err = validate_tour(stops, traced)
                if not err:
                    yield {"type": "tour", "stops": _enrich(stops)}
                    return
                out = {"error": err}
            else:
                try:
                    out = FUNCS[block.name](**args)
                except TypeError:
                    out = {"error": "invalid arguments"}
                if block.name == "trace_path" and isinstance(out, dict) and "path" in out:
                    traced = out["path"]
                if block.name == "search_codebase" and isinstance(out, list):
                    yield {"type": "candidates", "node_ids": [row["id"] for row in out[:5]]}
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(out)[:6000],
                }
            )
        if results:
            messages.append({"role": "user", "content": results})
    raise RuntimeError("agent did not produce a valid tour")
