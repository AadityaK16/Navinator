"""Replay a repo's git history through the parser.

For every commit that touched the backend, extract that snapshot, parse it into
the same node ids as graph.json, and record which nodes appeared or vanished.
The UI uses the result to scrub through time and show the call graph growing.

usage: python -m reponav.history <git_repo> <pin_sha> data/history.json
"""

import io
import json
import re
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

from .parser import parse_repo

# The template moved its backend twice. Each entry is (app dir in the tree,
# parse root inside the extracted copy) so module ids stay "app.*" in every era.
# Nested "app/app" layouts come first so they win over their parent folder.
LAYOUTS = [
    ("backend/app/app", "backend/app"),
    ("src/backend/app/app", "src/backend/app"),
    ("{{cookiecutter.project_slug}}/backend/app/app", "{{cookiecutter.project_slug}}/backend/app"),
    ("backend/app", "backend"),
    ("src/backend/app", "src/backend"),
]

# Python 3.14 allows `except A, B:` (PEP 758). Older interpreters reject it, so
# parenthesize before parsing, the same local fix demo-repo carries.
PEP758 = re.compile(r"^(\s*except\s+)(\w+(?:\s*,\s*\w+)+)(\s*(?:as\s+\w+)?\s*:)", re.M)

# The template prefixes commits with gitmoji, as ":sparkles:" or the glyph itself.
GITMOJI = re.compile(r"^(?::\w+:|[^\w\s`\"'(\[])+\s*")


def clean_subject(subject: str) -> str:
    return GITMOJI.sub("", subject).strip()


def git(repo: Path, *args: str) -> bytes:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True).stdout


def layout_for(repo: Path, sha: str) -> tuple[str, str] | None:
    names = set(git(repo, "ls-tree", "-d", "-r", "--name-only", sha).decode().splitlines())
    for app_dir, root in LAYOUTS:
        if app_dir in names:
            return app_dir, root
    return None


def snapshot(repo: Path, sha: str) -> tuple[dict, list] | None:
    layout = layout_for(repo, sha)
    if not layout:
        return None
    app_dir, root = layout
    data = git(repo, "archive", "--format=tar", sha, app_dir)
    with tempfile.TemporaryDirectory() as tmp:
        with tarfile.open(fileobj=io.BytesIO(data)) as tar:
            tar.extractall(tmp, filter="data")
        for path in Path(tmp).rglob("*.py"):
            text = path.read_text(errors="ignore")
            fixed = PEP758.sub(lambda m: f"{m[1]}({m[2]}){m[3]}", text)
            if fixed != text:
                path.write_text(fixed)
        return parse_repo(Path(tmp) / root)


def build(repo: Path, pin: str) -> dict:
    paths = [app_dir for app_dir, _ in LAYOUTS]
    shas = git(repo, "rev-list", "--reverse", "--first-parent", pin, "--", *paths).decode().split()
    snapshots = []
    previous: set[str] = set()
    for sha in shas:
        parsed = snapshot(repo, sha)
        if parsed is None:
            continue
        nodes, links = parsed
        ids = {nid for nid, node in nodes.items() if node["type"] != "external"}
        if ids == previous:
            continue
        meta = git(repo, "log", "-1", "--format=%h%x00%aI%x00%an%x00%s", sha).decode().strip().split("\x00")
        snapshots.append(
            {
                "sha": meta[0],
                "date": meta[1][:10],
                "author": meta[2],
                "subject": clean_subject(meta[3])[:120],
                "nodes": len(ids),
                "edges": sum(1 for link in links if link["type"] in ("calls", "depends")),
                "files": sum(1 for nid in ids if nodes[nid]["type"] == "file"),
                "added": sorted(ids - previous),
                "removed": sorted(previous - ids),
            }
        )
        previous = ids
        print(f"{meta[1][:10]} {meta[0]} {len(ids):4d} nodes", file=sys.stderr)

    # born_at: start of the latest unbroken run, so a node deleted and later
    # re-added counts from when it came back.
    born_at: dict[str, int] = {}
    alive: set[str] = set()
    for index, snap in enumerate(snapshots):
        for nid in snap["removed"]:
            alive.discard(nid)
            born_at.pop(nid, None)
        for nid in snap["added"]:
            alive.add(nid)
            born_at[nid] = index
    return {"pin": pin, "snapshots": snapshots, "born_at": born_at}


def main(argv: list[str]) -> None:
    if len(argv) != 4:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    history = build(Path(argv[1]), argv[2])
    Path(argv[3]).write_text(json.dumps(history, separators=(",", ":")) + "\n")
    print(f"{len(history['snapshots'])} snapshots, {len(history['born_at'])} live nodes")


if __name__ == "__main__":
    main(sys.argv)
