"""Parse a Python repo into a call graph.

Two passes: definitions, imports, and FastAPI dependency aliases, then call
and Depends edges. Nested functions, decorators-as-nodes, and calls on
parameter objects are left unresolved on purpose.
"""

import ast
import json
import sys
from collections import defaultdict
from pathlib import Path

SKIP = {
    "tests", "test", "migrations", "alembic", ".venv", "venv", "env",
    "node_modules", "site-packages", "__pycache__", ".git", "build", "dist",
}


def mod_name(root: Path, path: Path) -> tuple[str, bool]:
    parts = list(path.relative_to(root).with_suffix("").parts)
    is_pkg = parts[-1] == "__init__"
    if is_pkg:
        parts = parts[:-1]
    return ".".join(parts), is_pkg


def resolve_from(mod: str, is_pkg: bool, module: str | None, level: int) -> str:
    if level == 0:
        return module or ""
    base = mod.split(".") if is_pkg else mod.split(".")[:-1]
    if level > 1:
        base = base[: -(level - 1)]
    return ".".join(base + ([module] if module else []))


def parse_repo(root: Path | str) -> tuple[dict, list]:
    root = Path(root)
    nodes: dict[str, dict] = {}
    links: list[dict] = []
    defs: dict[str, ast.AST] = {}
    imports: dict[str, dict[str, str]] = defaultdict(dict)
    imported_modules: dict[str, set[str]] = defaultdict(set)
    # "app.api.deps.CurrentUser" -> (module, dependency expr)
    aliases: dict[str, tuple[str, ast.AST]] = {}

    def add_def(d, mod, rel, cluster, parent, cls=None):
        if not isinstance(d, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            return
        nid = f"{parent}.{d.name}"
        kind = "class" if isinstance(d, ast.ClassDef) else ("method" if cls else "function")
        nodes[nid] = dict(
            id=nid,
            label=d.name,
            type=kind,
            file_path=rel,
            line_start=d.lineno,
            line_end=d.end_lineno or d.lineno,
            module=mod,
            cls=cls,
            cluster=cluster,
            doc=(ast.get_docstring(d) or "")[:300],
        )
        links.append(
            dict(source=parent, target=nid, type="contains", line=None, confidence="exact")
        )
        if kind == "class":
            for m in d.body:
                add_def(m, mod, rel, cluster, parent=nid, cls=nid)
        else:
            defs[nid] = d

    for path in sorted(root.rglob("*.py")):
        if SKIP & set(path.parts):
            continue
        src = path.read_text(encoding="utf-8", errors="ignore")
        try:
            tree = ast.parse(src)
        except SyntaxError:
            continue
        mod, is_pkg = mod_name(root, path)
        if not mod:
            continue
        rel = str(path.relative_to(root))
        cluster = mod.rsplit(".", 1)[0] if "." in mod else mod
        nodes[mod] = dict(
            id=mod,
            label=path.name,
            type="file",
            file_path=rel,
            line_start=1,
            line_end=len(src.splitlines()) or 1,
            module=mod,
            cls=None,
            cluster=cluster,
            doc="",
        )
        for n in ast.walk(tree):
            if isinstance(n, ast.Import):
                for a in n.names:
                    full = a.name
                    imported_modules[mod].add(full)
                    if a.asname:
                        imports[mod][a.asname] = full
                    elif "." not in full:
                        imports[mod][full] = full
                    else:
                        # `import pkg.mod` binds pkg, not pkg.mod. Mapping pkg to
                        # pkg.mod breaks later attribute lookup, so keep pkg -> pkg.
                        top = full.split(".")[0]
                        imports[mod].setdefault(top, top)
            elif isinstance(n, ast.ImportFrom):
                if n.module is None and not n.level:
                    continue
                base = resolve_from(mod, is_pkg, n.module, n.level)
                if base:
                    imported_modules[mod].add(base)
                for a in n.names:
                    if a.name == "*":
                        continue
                    imports[mod][a.asname or a.name] = f"{base}.{a.name}" if base else a.name
        for d in tree.body:
            add_def(d, mod, rel, cluster, parent=mod)
            # CurrentUser = Annotated[User, Depends(get_current_user)]
            if isinstance(d, ast.Assign) and d.targets and isinstance(d.targets[0], ast.Name):
                for c in ast.walk(d.value):
                    if (
                        isinstance(c, ast.Call)
                        and getattr(c.func, "id", None) == "Depends"
                        and c.args
                    ):
                        aliases[f"{mod}.{d.targets[0].id}"] = (mod, c.args[0])

    by_name: dict[str, list[str]] = defaultdict(list)
    for nid, n in nodes.items():
        if n["type"] in ("function", "method"):
            by_name[n["label"]].append(nid)

    def resolve(expr, mod, cls):
        if isinstance(expr, ast.Name):
            local = f"{mod}.{expr.id}"
            if local in nodes and nodes[local]["type"] in ("function", "method", "class"):
                return local, "exact"
            imported = imports[mod].get(expr.id)
            if imported in nodes and nodes[imported]["type"] in ("function", "method", "class"):
                return imported, "exact"
            hits = by_name.get(expr.id, [])
            if len(hits) == 1:
                return hits[0], "heuristic"
        elif isinstance(expr, ast.Attribute):
            v = expr.value
            if isinstance(v, ast.Name):
                if v.id in ("self", "cls") and cls and f"{cls}.{expr.attr}" in nodes:
                    return f"{cls}.{expr.attr}", "exact"
                target = imports[mod].get(v.id)
                if target and f"{target}.{expr.attr}" in nodes:
                    return f"{target}.{expr.attr}", "exact"
            hits = by_name.get(expr.attr, [])
            if len(hits) == 1:
                return hits[0], "heuristic"
        return None, None

    seen: set[tuple] = set()

    def edge(src, tgt, kind, line, conf):
        if not tgt or tgt == src:
            return
        key = (src, tgt, kind)
        if key in seen:
            # ast.walk order is not source order; keep the earliest call site.
            if line is None:
                return
            for link in links:
                if (link["source"], link["target"], link["type"]) == key and (
                    link["line"] is None or line < link["line"]
                ):
                    link["line"] = line
            return
        seen.add(key)
        links.append(
            dict(source=src, target=tgt, type=kind, line=line, confidence=conf)
        )

    for nid, d in defs.items():
        n = nodes[nid]
        mod, cls = n["module"], n["cls"]
        for c in ast.walk(d):
            if not isinstance(c, ast.Call):
                continue
            if getattr(c.func, "id", None) == "Depends" and c.args:
                tgt, conf = resolve(c.args[0], mod, cls)
                edge(nid, tgt, "depends", c.lineno, conf)
            else:
                tgt, conf = resolve(c.func, mod, cls)
                edge(nid, tgt, "calls", c.lineno, conf)
        for arg in d.args.args + d.args.kwonlyargs:
            ann = arg.annotation
            if isinstance(ann, ast.Name):
                key = (
                    f"{mod}.{ann.id}"
                    if f"{mod}.{ann.id}" in aliases
                    else imports[mod].get(ann.id)
                )
                if key in aliases:
                    amod, dep = aliases[key]
                    tgt, conf = resolve(dep, amod, None)
                    edge(nid, tgt, "depends", arg.lineno, conf)

    for mod, modules in imported_modules.items():
        targets = set(modules) | set(imports[mod].values())
        for target in targets:
            t = (
                target
                if target in nodes and nodes[target]["type"] == "file"
                else target.rsplit(".", 1)[0]
            )
            if t in nodes and nodes[t]["type"] == "file" and t != mod:
                edge(mod, t, "imports", None, "exact")

    # Browser requests are outside the repo. The edge lands on the handler
    # that actually receives it: login.py:24 and deps.py:30.
    def add_external(nid, label, target):
        if target not in nodes:
            return
        nodes[nid] = dict(
            id=nid,
            label=label,
            type="external",
            file_path="",
            line_start=0,
            line_end=0,
            module="external",
            cls=None,
            cluster="external",
            doc="",
        )
        edge(nid, target, "calls", nodes[target]["line_start"], "manual")

    add_external(
        "external.browser.post_login_access_token",
        "POST /login/access-token",
        "app.api.routes.login.login_access_token",
    )
    add_external(
        "external.browser.authenticated_request",
        "Authenticated request",
        "app.api.deps.get_current_user",
    )
    return nodes, links


def main(argv: list[str]) -> None:
    if len(argv) != 3:
        print("usage: python -m reponav.parser <repo_root> <graph.json>", file=sys.stderr)
        sys.exit(2)
    nodes, links = parse_repo(argv[1])
    Path(argv[2]).write_text(
        json.dumps({"nodes": list(nodes.values()), "links": links}, indent=2) + "\n"
    )
    calls = [l for l in links if l["type"] in ("calls", "depends")]
    heur = sum(l["confidence"] == "heuristic" for l in calls)
    print(f"{len(nodes)} nodes, {len(calls)} call/depends edges ({heur} heuristic)")


if __name__ == "__main__":
    main(sys.argv)
