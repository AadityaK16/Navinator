import asyncio
import json

from reponav.agent import validate_tour
from reponav.graph import DATA, G, blast_radius, evidence_for, search_codebase, trace_path
from reponav import server

LOGIN = "app.api.routes.login.login_access_token"
AUTHENTICATE = "app.crud.authenticate"
VERIFY = "app.core.security.verify_password"
TOKEN = "app.core.security.create_access_token"
HASH = "app.core.security.get_password_hash"
EXTERNAL = "external.browser.post_login_access_token"


def test_search_ranks_login_route():
    hits = search_codebase("login token password")
    assert LOGIN in [hit["id"] for hit in hits[:3]]


def test_trace_login_through_authenticate_and_token():
    traced = trace_path([EXTERNAL, LOGIN, AUTHENTICATE, VERIFY])
    assert "error" not in traced
    assert AUTHENTICATE in traced["path"]
    assert traced["path"][0] == EXTERNAL
    assert traced["path"][-1] == VERIFY
    token = trace_path([LOGIN, TOKEN])
    assert token["path"] == [LOGIN, TOKEN]
    assert "authenticate" not in token["path"][-1]


def test_trace_unknown_and_unconnected():
    unknown = trace_path(["not.a.real.node", LOGIN])
    assert "error" in unknown
    assert "not in call graph" in unknown["error"]
    missing = trace_path([LOGIN, HASH])
    assert "error" in missing
    assert "no call path" in missing["error"]


def test_blast_radius_of_verify_password():
    hits = {row["id"]: row["distance"] for row in blast_radius(VERIFY)}
    assert hits[AUTHENTICATE] <= 3
    assert hits[LOGIN] <= 3


def test_validate_tour_rules():
    traced = ["a", "b", "c", "d"]
    assert validate_tour([{"node_id": "a"}, {"node_id": "b"}], traced) == "tour needs 3-7 stops"
    skipped = validate_tour(
        [{"node_id": "a"}, {"node_id": "b"}, {"node_id": "d"}],
        traced,
    )
    assert skipped and "no edge" in skipped
    assert (
        validate_tour(
            [{"node_id": "b"}, {"node_id": "c"}, {"node_id": "d"}],
            traced,
        )
        is None
    )
    real = trace_path([EXTERNAL, LOGIN, AUTHENTICATE, VERIFY])["path"]
    assert validate_tour([{"node_id": nid} for nid in real], real) is None
    assert validate_tour([{"node_id": nid} for nid in real[:2]], real)


def test_cached_tours_follow_real_edges():
    tours = json.loads((DATA / "demo_tours.json").read_text())
    assert set(tours) == {"auth", "session", "users"}
    for tour in tours.values():
        stops = tour["stops"]
        assert 3 <= len(stops) <= 7
        assert stops[0]["evidence"] == "entry point"
        for prev, stop in zip(stops, stops[1:]):
            assert G.has_edge(prev["node_id"], stop["node_id"])
            edge = G.edges[prev["node_id"], stop["node_id"]]
            assert stop["evidence"] == evidence_for(prev["node_id"], stop["node_id"], edge)


def _collect(agen):
    async def run():
        return [item async for item in agen]

    return run()


def test_invalid_agent_falls_back(monkeypatch):
    async def boom(_q):
        raise RuntimeError("agent did not produce a valid tour")
        yield {}

    monkeypatch.setattr(server, "use_live_agent", lambda: True)
    monkeypatch.setattr(server, "run_agent", boom)
    actions = asyncio.run(_collect(server.guarded("How does login work?")))
    assert any(a.get("message") == "Using saved route" for a in actions)
    tour = next(a for a in actions if a["type"] == "tour")
    assert tour["stops"][1]["node_id"] == LOGIN
    assert all(a["type"] != "error" for a in actions)


def test_slow_agent_falls_back(monkeypatch):
    async def slow(_q):
        yield {"type": "status", "message": "Searching: login"}
        yield {"type": "status", "message": "still going"}

    monkeypatch.setattr(server, "use_live_agent", lambda: True)
    monkeypatch.setattr(server, "run_agent", slow)
    monkeypatch.setattr(server, "ACTION_TIMEOUT_S", -1)
    actions = asyncio.run(_collect(server.guarded("How does login work?")))
    assert actions[0]["message"] == "Searching: login"
    assert any(a.get("message") == "Using saved route" for a in actions)
    assert any(a["type"] == "tour" for a in actions)
