from reponav import server
from reponav.knowledge import CODE_RELATIONS, KINDS, RELATIONS, build_knowledge, load_knowledge

LOGIN = "app.api.routes.login.login_access_token"
TOKEN = "app.core.security.create_access_token"
HEALTH = "app.api.routes.utils.health_check"


def fn(node_id: str, ref: str) -> dict:
    return {"id": node_id, "kind": "function", "cluster": "c", "title": node_id, "summary": "", "code_refs": [ref]}


def test_curated_map_is_fully_grounded():
    knowledge = load_knowledge()
    assert knowledge["rejected"] == []
    clusters = {c["id"] for c in knowledge["clusters"]}
    for node in knowledge["nodes"]:
        assert node["kind"] in KINDS
        assert node["cluster"] in clusters
        if node["kind"] in ("function", "architecture"):
            assert node["code_refs"], node["id"]
    for link in knowledge["links"]:
        assert link["relation"] in RELATIONS
        if link["relation"] in CODE_RELATIONS or link["relation"] == "depends_on":
            assert link["verified"] and link["evidence"], link


def test_conceptual_relations_are_never_marked_verified():
    knowledge = load_knowledge()
    for link in knowledge["links"]:
        if link["relation"] in ("implements", "explains", "related_to"):
            assert not link["verified"]
            assert link["evidence"] is None


def test_real_call_is_verified_with_line_evidence():
    raw = {
        "clusters": [],
        "nodes": [fn("a", LOGIN), fn("b", TOKEN)],
        "links": [{"source": "a", "target": "b", "relation": "calls_into"}],
    }
    built = build_knowledge(raw)
    assert built["links"][0]["verified"]
    assert built["links"][0]["evidence"] == "calls at app/api/routes/login.py:39"


def test_invented_call_is_rejected_not_shown():
    raw = {
        "clusters": [],
        "nodes": [fn("a", HEALTH), fn("b", TOKEN), fn("c", "app.does.not.exist")],
        "links": [
            {"source": "a", "target": "b", "relation": "calls_into"},
            {"source": "a", "target": "b", "relation": "depends_on"},
        ],
    }
    built = build_knowledge(raw)
    assert [link["relation"] for link in built["links"]] == ["depends_on"]
    assert built["links"][0]["verified"] is False
    reasons = [item["reason"] for item in built["rejected"]]
    assert "calls_into not found in the call graph" in reasons
    assert "unknown code ref app.does.not.exist" in reasons
    assert built["nodes"][2]["code_refs"] == []


def test_knowledge_endpoint_serves_the_map():
    payload = server.knowledge()
    assert {n["id"] for n in payload["nodes"]} >= {"concept.jwt", "fn.authenticate"}
