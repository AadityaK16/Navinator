"""Grok helpers: tour narration, text to speech, and regrouping.

Everything here degrades instead of failing the demo:
  no key      -> original narration, browser voice, keyword regrouping
  call fails  -> same fallbacks, with the reason passed back to the UI
Model ids come only from the graph; anything the model invents is dropped.
"""

from __future__ import annotations

import base64
import json
import os
import re
from collections import OrderedDict

import httpx

from .graph import G, GRAPH, NODES, _snippet, search_codebase

XAI_BASE = "https://api.x.ai/v1"
DEFAULT_CHAT_MODEL = "grok-4"
DEFAULT_VOICE = "ara"
VOICES = ["ara", "eve", "rex", "sal", "leo"]
CHAT_TIMEOUT_S = 40
TTS_TIMEOUT_S = 30


class GrokError(RuntimeError):
    pass


def xai_base() -> str:
    return (os.environ.get("XAI_BASE_URL") or XAI_BASE).rstrip("/")


def xai_key() -> str:
    return (os.environ.get("XAI_API_KEY") or "").strip()


def grok_info() -> dict:
    return {
        "chat": bool(xai_key()),
        "voice": bool(xai_key()),
        "model": os.environ.get("XAI_MODEL") or DEFAULT_CHAT_MODEL,
        "voices": VOICES,
        "default_voice": os.environ.get("XAI_VOICE") or DEFAULT_VOICE,
    }


# ---------------------------------------------------------------- chat


def _extract_json(text: str) -> dict:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise GrokError("model did not return JSON")
    return json.loads(text[start : end + 1])


async def chat_json(system: str, user: str, max_tokens: int = 3000) -> tuple[dict, str]:
    """Ask a chat model for JSON. Grok first, then the local model, then Claude."""
    errors = []
    if xai_key():
        try:
            return await _openai_style(
                f"{xai_base()}/chat/completions", xai_key(), os.environ.get("XAI_MODEL") or DEFAULT_CHAT_MODEL, system, user, max_tokens
            ), "grok"
        except Exception as exc:  # noqa: BLE001 - surface any provider failure as a fallback reason
            errors.append(f"grok: {exc}")
    from .agent import LOCAL_PROVIDERS, local_base_url, provider_info, provider

    if provider() in LOCAL_PROVIDERS:
        try:
            info = provider_info()
            return await _openai_style(
                f"{local_base_url()}/chat/completions", os.environ.get("LOCAL_LLM_KEY") or "local", info["model"], system, user, max_tokens
            ), "local"
        except Exception as exc:  # noqa: BLE001
            errors.append(f"local: {exc}")
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            from .agent import DEFAULT_MODEL, get_client

            resp = await get_client().messages.create(
                model=os.environ.get("MODEL") or DEFAULT_MODEL,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            text = "".join(getattr(block, "text", "") for block in resp.content)
            return _extract_json(text), "claude"
        except Exception as exc:  # noqa: BLE001
            from .agent import explain_error

            errors.append(f"Claude: {explain_error(exc)}")
    raise GrokError("; ".join(errors) or "no model configured")


async def _openai_style(url: str, key: str, model: str, system: str, user: str, max_tokens: int) -> dict:
    async with httpx.AsyncClient(timeout=CHAT_TIMEOUT_S) as client:
        resp = await client.post(
            url,
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": model,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "temperature": 0.3,
                "max_tokens": max_tokens,
            },
        )
    if resp.status_code >= 400:
        raise GrokError(f"{resp.status_code} {resp.text[:200]}")
    content = resp.json()["choices"][0]["message"].get("content") or ""
    return _extract_json(content)


# ---------------------------------------------------------------- narration

NARRATE_SYSTEM = """You narrate a guided tour through real code for a developer who has never seen it.
You get the developer's question and the tour stops in order, each with its source code.
For every stop write 2 or 3 short spoken sentences: what this code does in plain words, the one detail
from the code that matters for the question, and why the tour moves to the next stop.
Spoken style: no markdown, no bullet points, no code blocks, say names naturally (verify_password, not verify underscore password).
Only describe what the code shows. Return JSON: {"narrations": ["...", "..."]} with exactly one entry per stop, in order."""


def _stop_block(index: int, stop: dict) -> str:
    node = NODES.get(stop.get("node_id", ""), {})
    code = _snippet(node) if node else ""
    code = "\n".join(code.splitlines()[:40])
    return (
        f"Stop {index + 1}: {stop.get('node_id')}\n"
        f"How we got here: {stop.get('evidence', '')}\n"
        f"Draft narration: {stop.get('narration', '')}\n"
        f"Code:\n{code}\n"
    )


async def narrate(question: str, stops: list[dict]) -> tuple[list[dict], str, str | None]:
    """Returns (stops, source, error). Falls back to the original narration."""
    if not stops:
        return stops, "original", None
    user = f"Question: {question or 'Explain this path.'}\n\n" + "\n".join(_stop_block(i, s) for i, s in enumerate(stops))
    try:
        data, source = await chat_json(NARRATE_SYSTEM, user, max_tokens=2000)
    except GrokError as exc:
        return stops, "original", str(exc)
    lines = data.get("narrations")
    if not isinstance(lines, list) or len(lines) != len(stops):
        return stops, "original", "model returned the wrong number of narrations"
    rewritten = []
    for stop, line in zip(stops, lines):
        text = str(line).strip() if line else ""
        rewritten.append({**stop, "narration": text or stop.get("narration", "")})
    return rewritten, source, None


# ---------------------------------------------------------------- speech

_tts_cache: OrderedDict[tuple[str, str], tuple[bytes, str]] = OrderedDict()
_tts_shape: str | None = None


def _tts_bodies(text: str, voice: str) -> dict[str, dict]:
    # xAI docs in the wild show two request shapes. Try the native one first and
    # remember whichever works.
    return {
        "native": {
            "text": text,
            "voice_id": voice,
            "language": "en",
            "output_format": {"codec": "mp3", "sample_rate": 24000, "bit_rate": 128000},
        },
        "openai": {
            "model": os.environ.get("XAI_TTS_MODEL") or "grok-tts-1",
            "voice": voice,
            "input": text,
            "format": "mp3",
        },
    }


async def _audio_from(resp: httpx.Response, client: httpx.AsyncClient) -> tuple[bytes, str]:
    kind = resp.headers.get("content-type", "").split(";")[0].strip()
    if kind.startswith("audio/") or kind == "application/octet-stream":
        return resp.content, kind if kind.startswith("audio/") else "audio/mpeg"
    data = resp.json()
    for key in ("audio", "data", "audio_url", "url"):
        value = data.get(key) if isinstance(data, dict) else None
        if isinstance(value, dict):
            value = value.get("url") or value.get("data")
        if not isinstance(value, str) or not value:
            continue
        if value.startswith("http"):
            fetched = await client.get(value)
            fetched.raise_for_status()
            return fetched.content, fetched.headers.get("content-type", "audio/mpeg")
        return base64.b64decode(value), "audio/mpeg"
    raise GrokError("speech response had no audio")


async def speak(text: str, voice: str | None = None) -> tuple[bytes, str]:
    global _tts_shape
    key = xai_key()
    if not key:
        raise GrokError("XAI_API_KEY is not set")
    voice = voice if voice in VOICES else (os.environ.get("XAI_VOICE") or DEFAULT_VOICE)
    text = text.strip()[:4000]
    cached = _tts_cache.get((voice, text))
    if cached:
        _tts_cache.move_to_end((voice, text))
        return cached
    url = os.environ.get("XAI_TTS_URL") or f"{xai_base()}/tts"
    bodies = _tts_bodies(text, voice)
    order = [_tts_shape] if _tts_shape else []
    order += [name for name in ("native", "openai") if name not in order]
    last = ""
    async with httpx.AsyncClient(timeout=TTS_TIMEOUT_S) as client:
        for shape in order:
            resp = await client.post(url, headers={"Authorization": f"Bearer {key}"}, json=bodies[shape])
            if resp.status_code in (401, 403):
                raise GrokError(f"xAI rejected the key ({resp.status_code})")
            if resp.status_code >= 400:
                last = f"{resp.status_code} {resp.text[:200]}"
                continue
            audio = await _audio_from(resp, client)
            _tts_shape = shape
            _tts_cache[(voice, text)] = audio
            if len(_tts_cache) > 200:
                _tts_cache.popitem(last=False)
            return audio
    raise GrokError(f"speech failed: {last}")


# ---------------------------------------------------------------- regroup

REGROUP_SYSTEM = """You reorganize a code graph into groups for a developer exploring it.
You get the developer's request, every node (id, kind, file, first doc line), and the call edges.
Make 2 to 9 groups whose names a developer would understand (for example "Login and tokens", "Item CRUD").
If the request asks to focus on part of the code, include only the relevant nodes and leave the rest out.
Otherwise put every node in exactly one group.
Use only node ids from the list. Never invent ids. Each id appears in at most one group.
Return JSON:
{"title": "short name for this grouping",
 "summary": "one sentence on how you grouped",
 "groups": [{"name": "...", "why": "one short sentence", "members": ["node id", "..."]}]}"""


def _catalog() -> str:
    rows = []
    for n in GRAPH["nodes"]:
        doc = (n.get("doc") or "").strip().splitlines()
        rows.append(f"{n['id']} | {n['type']} | {n['file_path'] or '-'} | {doc[0][:80] if doc else ''}")
    edges = [f"{a} -> {b} ({d.get('type')})" for a, b, d in G.edges(data=True)]
    return "NODES\n" + "\n".join(rows) + "\n\nEDGES\n" + "\n".join(edges)


def _clean_groups(raw: dict) -> list[dict]:
    seen: set[str] = set()
    groups = []
    for group in raw.get("groups") or []:
        if not isinstance(group, dict):
            continue
        members = []
        for nid in group.get("members") or []:
            if isinstance(nid, str) and nid in NODES and nid not in seen:
                seen.add(nid)
                members.append(nid)
        if members:
            groups.append(
                {
                    "name": str(group.get("name") or f"Group {len(groups) + 1}")[:60],
                    "why": str(group.get("why") or "")[:200],
                    "members": members,
                }
            )
    return groups[:12]


def keyword_regroup(prompt: str) -> dict:
    """No model available: keep what matches the request plus direct neighbours,
    grouped by file."""
    ranked = search_codebase(prompt, k=10)
    if not ranked:
        raise GrokError("nothing in the code matched those words")
    top = ranked[0]["score"]
    hits = [h["id"] for h in ranked if h["score"] >= top * 0.45]
    keep = set(hits)
    by_file: dict[str, list[str]] = {}
    for nid in sorted(keep):
        node = NODES.get(nid)
        if not node:
            continue
        by_file.setdefault(node["file_path"] or "browser", []).append(nid)
    groups = [
        {"name": path.removeprefix("app/"), "why": "matched the words in your request", "members": ids}
        for path, ids in by_file.items()
    ]
    return {
        "title": f"Keyword focus: {prompt[:40]}",
        "summary": "No AI key, so this keeps the code that best matches your words, grouped by file.",
        "groups": groups,
    }


async def regroup(prompt: str, current: dict | None = None) -> dict:
    user = f"Request: {prompt}\n\n"
    if current and current.get("groups"):
        user += "The developer is currently looking at this grouping, which you may refine:\n"
        user += json.dumps({"title": current.get("title"), "groups": [{"name": g.get("name"), "members": g.get("members")} for g in current["groups"]]})[:6000]
        user += "\n\n"
    user += _catalog()
    source = "keyword"
    try:
        raw, source = await chat_json(REGROUP_SYSTEM, user, max_tokens=4000)
        groups = _clean_groups(raw)
        if not groups:
            raise GrokError("model returned no usable groups")
        result = {"title": str(raw.get("title") or prompt)[:60], "summary": str(raw.get("summary") or "")[:240], "groups": groups}
        error = None
    except GrokError as exc:
        error = str(exc)
        try:
            result = keyword_regroup(prompt)
        except GrokError as miss:
            if error == "no model configured":
                raise GrokError(f"{miss}. Add XAI_API_KEY or ANTHROPIC_API_KEY for AI regrouping.") from exc
            raise GrokError(f"AI regrouping failed ({error}), and {miss}.") from exc
        source = "keyword"
    placed = {nid for g in result["groups"] for nid in g["members"]}
    result["hidden"] = sorted(nid for nid in NODES if nid not in placed)
    result["source"] = source
    if error:
        result["note"] = error
    return result
