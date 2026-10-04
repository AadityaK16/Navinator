import pytest

from reponav import graph, repos, server


@pytest.fixture(autouse=True)
def scratch(tmp_path, monkeypatch):
    monkeypatch.setattr(repos, "UPLOADS", tmp_path / "uploads")
    monkeypatch.setattr(repos, "LAYOUTS", tmp_path / "layouts")
    yield
    repos.activate(repos.DEMO)


def test_lists_demo_and_samples():
    ids = [r["id"] for r in repos.list_repos()["repos"]]
    assert ids[0] == "demo"
    assert {"sample:todo-api", "sample:shop-checkout", "sample:weather-cli"} <= set(ids)


def test_activate_sample_swaps_graph_and_search():
    repos.activate("sample:todo-api")
    assert "app.routes.auth.login" in graph.NODES
    assert graph.trace_path(["app.routes.auth.login", "app.security.hash_password"])["path"][-1] == (
        "app.security.hash_password"
    )
    assert "app.routes.auth.login" in [h["id"] for h in graph.search_codebase("login password")]
    assert not any(n["type"] == "external" for n in graph.GRAPH["nodes"])
    assert repos.layout_path().parent == repos.LAYOUTS
    with pytest.raises(server.HTTPException):
        server.history()


def test_upload_writes_parses_and_removes():
    files = [
        {"path": "pkg/a.py", "content": "from .b import helper\n\ndef run():\n    return helper()\n"},
        {"path": "pkg/b.py", "content": "def helper():\n    return 1\n"},
        {"path": "../escape.py", "content": "x = 1\n"},
        {"path": "notes.txt", "content": "skip me"},
    ]
    listed = repos.upload("My Project", files)
    assert listed["active"] == "upload:my-project"
    assert ("pkg.a.run", "pkg.b.helper") in graph.G.edges
    assert not (repos.UPLOADS.parent / "escape.py").exists()
    assert sorted(p.name for p in (repos.UPLOADS / "my-project").rglob("*") if p.is_file()) == ["a.py", "b.py"]
    after = repos.delete("upload:my-project")
    assert after["active"] == "demo"
    assert not (repos.UPLOADS / "my-project").exists()


def test_rejects_empty_upload_and_unknown_ids():
    with pytest.raises(repos.RepoError):
        repos.upload("empty", [{"path": "readme.md", "content": "hi"}])
    with pytest.raises(repos.RepoError):
        repos.activate("sample:../../etc")
    with pytest.raises(repos.RepoError):
        repos.delete("sample:todo-api")
