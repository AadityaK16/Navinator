"""Graph API and the question stream. Live agent failures fall back to a saved tour."""

import asyncio
import json
import os
import time
from collections.abc import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from .agent import LOCAL_PROVIDERS, explain_error, provider, run_agent
from . import grok, repos
from .graph import DATA, GRAPH, NODES, blast_radius, node_source, search_codebase

app = FastAPI(title="RepoNav")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CACHED = json.loads((DATA / "demo_tours.json").read_text())
HISTORY_PATH = DATA / "history.json"
ACTION_TIMEOUT_S = 60
LOCAL_ACTION_TIMEOUT_S = 120


def use_live_agent() -> bool:
    if os.environ.get("DEMO_MODE") == "cached":
        return False
    if provider() in LOCAL_PROVIDERS:
        return True
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
    demo = repos.is_demo()
    if not use_live_agent():
        if not demo:
            yield {
                "type": "error",
                "message": "Saved tours only cover the demo repo. Add ANTHROPIC_API_KEY or run private mode to ask about this one.",
            }
            return
        async for action in mock_agent(q):
            yield action
        return
    start = time.monotonic()
    try:
        async for action in run_agent(q):
            yield action
            if action["type"] == "tour":
                return
            limit = LOCAL_ACTION_TIMEOUT_S if provider() in LOCAL_PROVIDERS else ACTION_TIMEOUT_S
            if time.monotonic() - start > limit:
                raise TimeoutError
    except Exception as exc:
        if not demo:
            yield {"type": "error", "message": f"The agent could not finish a tour. {explain_error(exc) if str(exc) else 'It ran too long.'}"}
            return
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
    layout_path = repos.layout_path()
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


@app.get("/history")
def history():
    if not repos.is_demo():
        raise HTTPException(status_code=404, detail="history is only recorded for the demo repo")
    if not HISTORY_PATH.exists():
        raise HTTPException(status_code=404, detail="no history; run python -m reponav.history")
    return json.loads(HISTORY_PATH.read_text())


@app.get("/config")
def config():
    from .agent import provider_info

    info = provider_info()
    info["live"] = use_live_agent()
    info["grok"] = grok.grok_info()
    return info


class NarrateBody(BaseModel):
    question: str = ""
    stops: list[dict]


@app.post("/narrate")
async def narrate(body: NarrateBody):
    stops, source, error = await grok.narrate(body.question, body.stops)
    return {"stops": stops, "source": source, "error": error}


class SpeakBody(BaseModel):
    text: str
    voice: str | None = None


@app.post("/speak")
async def speak(body: SpeakBody):
    if not grok.xai_key():
        raise HTTPException(status_code=503, detail="XAI_API_KEY is not set")
    try:
        audio, mime = await grok.speak(body.text, body.voice)
    except grok.GrokError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(content=audio, media_type=mime, headers={"Cache-Control": "no-store"})


class RegroupBody(BaseModel):
    prompt: str
    current: dict | None = None


@app.post("/regroup")
async def regroup(body: RegroupBody):
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Say how you want the code grouped.")
    try:
        return await grok.regroup(prompt, body.current)
    except grok.GrokError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/architecture")
def architecture_view():
    from .architecture import architecture

    return architecture()


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
    path = repos.layout_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))
    return {"ok": True}


@app.get("/repos")
def list_repos():
    return repos.list_repos()


class ActivateBody(BaseModel):
    id: str


@app.post("/repos/activate")
def activate_repo(body: ActivateBody):
    try:
        return repos.activate(body.id)
    except repos.RepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class UploadFile(BaseModel):
    path: str
    content: str


class UploadBody(BaseModel):
    name: str
    files: list[UploadFile]


@app.post("/repos/upload")
def upload_repo(body: UploadBody):
    try:
        return repos.upload(body.name, [f.model_dump() for f in body.files])
    except repos.RepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/repos/{repo_id}")
def delete_repo(repo_id: str):
    try:
        return repos.delete(repo_id)
    except repos.RepoError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
