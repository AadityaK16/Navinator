"""Tool-calling loop. The model picks waypoints; the graph validates the tour."""

import asyncio
import json
import os
from urllib.parse import urlparse

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

# Providers. "anthropic" is the hosted default. "ollama" and "openai_compat"
# (LM Studio, llama.cpp server, vLLM) speak the OpenAI chat API, so a local
# Llama or Qwen runs the same tools and the same tour validator.
LOCAL_PROVIDERS = {"ollama", "openai_compat"}
LOCAL_DEFAULT_URL = {"ollama": "http://localhost:11434/v1", "openai_compat": "http://localhost:1234/v1"}
LOCAL_DEFAULT_MODEL = "llama3.1:8b"


def provider() -> str:
    return (os.environ.get("LLM_PROVIDER") or "anthropic").strip().lower()


def local_base_url() -> str:
    return (os.environ.get("LOCAL_LLM_URL") or LOCAL_DEFAULT_URL.get(provider(), LOCAL_DEFAULT_URL["ollama"])).rstrip("/")


def is_on_device(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".localhost")


def provider_info() -> dict:
    name = provider()
    if name in LOCAL_PROVIDERS:
        url = local_base_url()
        return {
            "provider": name,
            "model": os.environ.get("LOCAL_MODEL") or LOCAL_DEFAULT_MODEL,
            "on_device": is_on_device(url),
        }
    return {"provider": "anthropic", "model": os.environ.get("MODEL") or DEFAULT_MODEL, "on_device": False}


def local_tools() -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool["description"],
                "parameters": tool["input_schema"],
            },
        }
        for tool in TOOLS
    ]


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


def run_tool(name: str, args: dict, state: dict) -> tuple[dict | list, list[dict]]:
    """Run one tool call. Returns (result for the model, UI actions to emit)."""
    actions: list[dict] = []
    if name == "present_tour":
        stops = args.get("stops") or []
        err = validate_tour(stops, state.get("traced"))
        if not err:
            actions.append({"type": "tour", "stops": _enrich(stops)})
            return {"ok": True}, actions
        return {"error": err}, actions
    if name not in FUNCS:
        return {"error": f"unknown tool {name}"}, actions
    try:
        out = FUNCS[name](**args)
    except TypeError:
        out = {"error": "invalid arguments"}
    if name == "trace_path" and isinstance(out, dict) and "path" in out:
        state["traced"] = out["path"]
    if name == "search_codebase" and isinstance(out, list):
        actions.append({"type": "candidates", "node_ids": [row["id"] for row in out[:5]]})
    return out, actions


async def run_agent(q: str):
    if provider() in LOCAL_PROVIDERS:
        async for action in run_local_agent(q):
            yield action
        return
    client = get_client()
    model = os.environ.get("MODEL") or DEFAULT_MODEL
    messages = [{"role": "user", "content": q}]
    state: dict = {"traced": None}
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
            out, actions = run_tool(block.name, args, state)
            for action in actions:
                yield action
                if action["type"] == "tour":
                    return
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


def _parse_args(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


async def run_local_agent(q: str):
    """Same loop against a local OpenAI-compatible server. No code leaves the box
    when LOCAL_LLM_URL points at localhost."""
    import httpx

    info = provider_info()
    url = f"{local_base_url()}/chat/completions"
    timeout = float(os.environ.get("LOCAL_TIMEOUT_S") or 60)
    yield {"type": "status", "message": f"Running {info['model']} locally" if info["on_device"] else f"Running {info['model']}"}
    messages: list[dict] = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}]
    state: dict = {"traced": None}
    async with httpx.AsyncClient(timeout=timeout) as client:
        for _ in range(10):
            resp = await client.post(
                url,
                json={
                    "model": info["model"],
                    "messages": messages,
                    "tools": local_tools(),
                    "temperature": 0.1,
                    "max_tokens": 1500,
                },
                headers={"Authorization": f"Bearer {os.environ.get('LOCAL_LLM_KEY') or 'local'}"},
            )
            resp.raise_for_status()
            message = resp.json()["choices"][0]["message"]
            calls = message.get("tool_calls") or []
            messages.append(
                {"role": "assistant", "content": message.get("content") or "", "tool_calls": calls}
                if calls
                else {"role": "assistant", "content": message.get("content") or ""}
            )
            if not calls:
                messages.append(
                    {"role": "user", "content": "Use the tools. Finish by calling present_tour with stops on a traced path."}
                )
                continue
            for index, call in enumerate(calls):
                fn = call.get("function") or {}
                name = fn.get("name", "")
                args = _parse_args(fn.get("arguments"))
                yield {"type": "status", "message": label(name, args)}
                out, actions = run_tool(name, args, state)
                for action in actions:
                    yield action
                    if action["type"] == "tour":
                        return
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id") or f"call_{index}",
                        "name": name,
                        "content": json.dumps(out)[:6000],
                    }
                )
    raise RuntimeError("local agent did not produce a valid tour")
