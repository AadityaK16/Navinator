"""Per-file facts for the 2D architecture view: a friendly role and the
libraries each file leans on, read from its import lines."""

import ast

from . import graph

# import prefix -> label shown as a small tag next to the file's circle
TECH = [
    ("fastapi", "FastAPI"),
    ("sqlmodel", "SQLModel"),
    ("sqlalchemy", "SQLAlchemy"),
    ("pydantic", "Pydantic"),
    ("jwt", "JWT"),
    ("pwdlib", "Password hashing"),
    ("passlib", "Password hashing"),
    ("emails", "Email"),
    ("jinja2", "Templates"),
    ("sentry_sdk", "Sentry"),
    ("httpx", "HTTP client"),
    ("requests", "HTTP client"),
    ("tenacity", "Retries"),
    ("alembic", "Migrations"),
]


def _imports(path) -> list[str]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"))
    except (OSError, SyntaxError):
        return []
    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names += [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.append(node.module)
    return names


def role_for(file_path: str) -> str:
    parts = file_path.split("/")
    name = parts[-1].removesuffix(".py")
    folder = "/".join(parts[:-1])
    if folder.endswith("api/routes"):
        return "API route"
    if name == "deps":
        return "Dependencies"
    if name == "crud":
        return "Database ops"
    if name == "models":
        return "Data models"
    if name in ("db", "database"):
        return "Database"
    if name in ("security", "auth"):
        return "Security"
    if name in ("config", "settings"):
        return "Settings"
    if name in ("main", "app"):
        return "App startup"
    if name.startswith("initial") or name.endswith("_pre_start"):
        return "Startup script"
    if "util" in name:
        return "Helpers"
    if folder.endswith("core"):
        return "Core"
    return "Module"


def architecture() -> dict:
    files = {}
    for node in graph.GRAPH["nodes"]:
        if node["type"] != "file" or not node["file_path"]:
            continue
        imported = _imports(graph.REPO_ROOT / node["file_path"])
        tags: list[str] = []
        for prefix, label in TECH:
            if label in tags:
                continue
            if any(name == prefix or name.startswith(prefix + ".") for name in imported):
                tags.append(label)
        files[node["file_path"]] = {"role": role_for(node["file_path"]), "tech": tags[:3], "doc": node.get("doc", "")}
    return {"files": files}
