import asyncio

from reponav import grok
from reponav.graph import NODES


def test_clean_groups_drops_unknown_and_duplicate_ids():
    real = sorted(NODES)[:3]
    raw = {"groups": [
        {"name": "A", "members": [real[0], "invented.node", real[1]]},
        {"name": "B", "members": [real[1], real[2]]},
        {"name": "Empty", "members": ["also.fake"]},
    ]}
    groups = grok._clean_groups(raw)
    assert [g["name"] for g in groups] == ["A", "B"]
    assert groups[0]["members"] == [real[0], real[1]]
    assert groups[1]["members"] == [real[2]]


def test_regroup_without_keys_falls_back_to_keywords(monkeypatch):
    for key in ("XAI_API_KEY", "ANTHROPIC_API_KEY", "LLM_PROVIDER"):
        monkeypatch.delenv(key, raising=False)
    result = asyncio.run(grok.regroup("password hashing"))
    assert result["source"] == "keyword"
    members = {nid for g in result["groups"] for nid in g["members"]}
    assert "app.core.security.get_password_hash" in members
    assert set(result["hidden"]) == set(NODES) - members


def test_narrate_without_keys_keeps_original(monkeypatch):
    for key in ("XAI_API_KEY", "ANTHROPIC_API_KEY", "LLM_PROVIDER"):
        monkeypatch.delenv(key, raising=False)
    stops = [{"node_id": "app.crud.authenticate", "narration": "original", "evidence": "entry point"}]
    out, source, error = asyncio.run(grok.narrate("q", stops))
    assert source == "original" and out == stops and error
