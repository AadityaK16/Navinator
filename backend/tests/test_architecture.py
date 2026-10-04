from reponav.architecture import architecture, role_for


def test_roles_and_tags_for_known_files():
    files = architecture()["files"]
    assert files["app/api/routes/login.py"]["role"] == "API route"
    assert "FastAPI" in files["app/api/routes/login.py"]["tech"]
    assert files["app/core/security.py"]["role"] == "Security"
    assert "JWT" in files["app/core/security.py"]["tech"]
    assert files["app/crud.py"]["role"] == "Database ops"


def test_role_fallback():
    assert role_for("app/something/else.py") == "Module"


def test_architecture_follows_the_active_repo():
    from reponav import repos

    samples = [r for r in repos.list_repos()["repos"] if r["kind"] == "sample"]
    if not samples:
        return
    try:
        repos.activate(samples[0]["id"])
        files = architecture()["files"]
        assert files and not any(path.startswith("app/api/routes/") for path in files)
    finally:
        repos.activate(repos.DEMO)
