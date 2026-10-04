"""Which repo the graph shows: the pinned demo, a bundled sample, or a folder you uploaded.

Samples live in sample-repos/ at the project root. Uploads and every non-demo
layout live under data/, which git ignores.
"""

import json
import os
import re
import shutil
from pathlib import Path, PurePosixPath

from . import graph
from .parser import SKIP, parse_repo

SAMPLES = graph.BACKEND_DIR.parent / "sample-repos"
UPLOADS = graph.DATA / "uploads"
LAYOUTS = graph.DATA / "layouts"
DEMO = "demo"
MAX_FILES = 3000
MAX_BYTES = 20_000_000

_active = DEMO


class RepoError(Exception):
    pass


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48] or "repo"


def _root(repo_id: str) -> Path | None:
    if repo_id == DEMO:
        return _demo_root()
    kind, _, name = repo_id.partition(":")
    base = {"sample": SAMPLES, "upload": UPLOADS}.get(kind)
    if not base or not name or slug(name) != name:
        return None
    path = base / name
    return path if path.is_dir() else None


def _demo_root() -> Path:
    repo = Path(os.environ.get("REPO_ROOT", "../demo-repo/backend"))
    return repo if repo.is_absolute() else (graph.BACKEND_DIR / repo).resolve()


def _entry(repo_id: str, name: str, kind: str, root: Path) -> dict:
    files = sum(1 for p in root.rglob("*.py") if not SKIP & set(p.relative_to(root).parts))
    return {"id": repo_id, "name": name, "kind": kind, "files": files}


def list_repos() -> dict:
    repos = [{"id": DEMO, "name": "full-stack-fastapi-template", "kind": "demo", "files": None}]
    for kind, base in (("sample", SAMPLES), ("upload", UPLOADS)):
        if base.is_dir():
            for path in sorted(p for p in base.iterdir() if p.is_dir()):
                if slug(path.name) == path.name:
                    repos.append(_entry(f"{kind}:{path.name}", path.name, kind, path))
    return {"active": _active, "repos": repos}


def active() -> str:
    return _active


def is_demo() -> bool:
    return _active == DEMO


def layout_path(repo_id: str | None = None) -> Path:
    repo_id = repo_id or _active
    if repo_id == DEMO:
        return graph.DATA / "layout.json"
    return LAYOUTS / f"{repo_id.replace(':', '--')}.json"


def activate(repo_id: str) -> dict:
    global _active
    root = _root(repo_id)
    if root is None:
        raise RepoError(f"unknown repo {repo_id}")
    if repo_id == DEMO:
        data = json.loads((graph.DATA / "graph.json").read_text())
    else:
        nodes, links = parse_repo(root)
        data = {"nodes": list(nodes.values()), "links": links}
    if not data["nodes"]:
        raise RepoError("no Python files found in that folder")
    graph.load_graph(data, root)
    _active = repo_id
    return list_repos()


def _clean_path(raw: str) -> PurePosixPath | None:
    path = PurePosixPath(raw.replace("\\", "/"))
    if path.is_absolute() or ".." in path.parts or path.suffix != ".py":
        return None
    return path


def upload(name: str, files: list[dict]) -> dict:
    """Write the .py files of a picked folder to data/uploads/<name> and switch to it."""
    if len(files) > MAX_FILES:
        raise RepoError(f"too many files ({len(files)}); the limit is {MAX_FILES}")
    clean = [(p, f["content"]) for f in files if (p := _clean_path(f["path"]))]
    if not clean:
        raise RepoError("no Python files found in that folder")
    if sum(len(content) for _, content in clean) > MAX_BYTES:
        raise RepoError("those files are over 20 MB of Python")
    repo_slug = slug(name)
    dest = UPLOADS / repo_slug
    if dest.exists():
        shutil.rmtree(dest)
    for path, content in clean:
        target = dest / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    layout_path(f"upload:{repo_slug}").unlink(missing_ok=True)
    try:
        return activate(f"upload:{repo_slug}")
    except RepoError:
        shutil.rmtree(dest, ignore_errors=True)
        raise


def delete(repo_id: str) -> dict:
    if not repo_id.startswith("upload:") or _root(repo_id) is None:
        raise RepoError("only uploaded repos can be removed")
    if _active == repo_id:
        activate(DEMO)
    shutil.rmtree(_root(repo_id))
    layout_path(repo_id).unlink(missing_ok=True)
    return list_repos()
