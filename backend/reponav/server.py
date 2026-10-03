"""Graph API and the question stream. Live agent failures fall back to a saved tour."""

import asyncio
import json
import os
import time
from collections.abc import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .agent import run_agent
from .graph import DATA, GRAPH, NODES, blast_radius, node_source, search_codebase

app = FastAPI(title="RepoNav")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CACHED = json.loads((DATA / "demo_tours.json").read_text())
ACTION_TIMEOUT_S = 25


def use_live_agent() -> bool:
    if os.environ.get("DEMO_MODE") == "cached":
        return False
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def cached_key(q: str) -> str:
    ql = q.lower()
    if "current user" in ql or "bearer" in ql or "authenticated" in ql:
        return "session"
    if any(word in ql for word in ("creat", "register", "signup", "sign up", "new user")):
        return "users"
    return "auth"


def _tour_or_error(q: str) -> dict:
    key = cached_key(q)
    tour = CACHED.get(key) or CACHED.get("auth")
    if not tour:
        return {"type": "error", "message": "No saved tour is available."}
    return {"type": "tour", "stops": tour["stops"]}


async def mock_agent(q: str) -> AsyncIterator[dict]:
    key = cached_key(q)
    tour = CACHED.get(key) or CACHED.get("auth") or {"stops": []}
    stops = tour.get("stops") or []
    found = stops[1]["node_id"].split(".")[-1] if len(stops) > 1 else "route"
    phrases = {
        "auth": "Searching: login, token, password",
        "session": "Searching: current user, bearer token",
        "users": "Searching: create user, register",
    }
    for message in (
        phrases.get(key, "Searching: login, token, password"),
        f"Found {found}",
        "Tracing call path",
    ):
        yield {"type": "status", "message": message}
        await asyncio.sleep(0.6)
    action = _tour_or_error(q)
    yield action


async def guarded(q: str) -> AsyncIterator[dict]:
    if not use_live_agent():
        async for action in mock_agent(q):
            yield action
        return
    start = time.monotonic()
    try:
        async for action in run_agent(q):
            yield action
            if action["type"] == "tour":
                return
            if time.monotonic() - start > ACTION_TIMEOUT_S:
                raise TimeoutError
    except Exception:
        yield {"type": "status", "message": "Using saved route"}
        yield _tour_or_error(q)


class LayoutNode(BaseModel):
    id: str
    x: float
    y: float
    z: float


class LayoutBody(BaseModel):
    nodes: list[LayoutNode]


def graph_payload() -> dict:
    positions = {}
    layout_path = DATA / "layout.json"
    if layout_path.exists():
        raw = json.loads(layout_path.read_text())
        positions = {n["id"]: n for n in raw.get("nodes", [])}
    nodes = []
    for node in GRAPH["nodes"]:
        copy = dict(node)
        pos = positions.get(node["id"])
        if pos:
            copy["x"] = pos["x"]
            copy["y"] = pos["y"]
            copy["z"] = pos["z"]
            copy["fx"] = pos["x"]
            copy["fy"] = pos["y"]
            copy["fz"] = pos["z"]
        nodes.append(copy)
    links = GRAPH["links"]
    if len(nodes) > 1500:
        links = [link for link in links if link["type"] != "imports"]
    return {"nodes": nodes, "links": links}


@app.get("/graph")
def graph():
    return graph_payload()


@app.get("/search")
def search(q: str = ""):
    return search_codebase(q)


@app.get("/node/{nid:path}")
def node(nid: str):
    nid = nid.strip("/")
    if nid not in NODES:
        raise HTTPException(status_code=404, detail="node not found")
    return {**NODES[nid], "file_source": node_source(nid)}


@app.get("/blast/{nid:path}")
def blast(nid: str):
    nid = nid.strip("/")
    if nid not in NODES:
        raise HTTPException(status_code=404, detail="node not found")
    return blast_radius(nid)


@app.post("/layout")
def save_layout(body: LayoutBody):
    payload = {"nodes": [n.model_dump() for n in body.nodes]}
    (DATA / "layout.json").write_text(json.dumps(payload))
    return {"ok": True}


@app.get("/ask")
async def ask(q: str = ""):
    async def stream():
        async for action in guarded(q):
            yield f"data: {json.dumps(action)}\n\n"
        yield 'data: {"type": "done"}\n\n'

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
