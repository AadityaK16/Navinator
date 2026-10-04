"""Write a structured 3D layout to data/layout.json.

Three nested levels of spheres, so depth carries meaning:
  folders  spread around a big sphere,
  files    on a sphere around their folder's centre,
  symbols  orbiting their own file node.
Browser entry points sit just outside the node they hit.

usage: python -m reponav.layout3d [data/graph.json] [data/layout.json]
"""

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

GOLDEN = math.pi * (3 - math.sqrt(5))


def fib_sphere(count: int, radius: float, twist: float = 0.0) -> list[tuple[float, float, float]]:
    """Evenly spread `count` points over a sphere (Fibonacci lattice)."""
    if count == 1:
        return [(0.0, 0.0, 0.0)]
    points = []
    for i in range(count):
        y = 1 - 2 * (i + 0.5) / count
        ring = math.sqrt(max(0.0, 1 - y * y))
        theta = GOLDEN * i + twist
        points.append((math.cos(theta) * ring * radius, y * radius, math.sin(theta) * ring * radius))
    return points


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def build(graph: dict) -> list[dict]:
    nodes = graph["nodes"]
    by_id = {n["id"]: n for n in nodes}
    files = [n for n in nodes if n["type"] == "file"]
    members: dict[str, list[dict]] = defaultdict(list)
    file_of_path = {n["file_path"]: n["id"] for n in files}
    for n in nodes:
        if n["type"] in ("class", "function", "method"):
            members[file_of_path.get(n["file_path"], "")].append(n)

    folders: dict[str, list[dict]] = defaultdict(list)
    for f in files:
        folders[f["cluster"]].append(f)

    def member_radius(fid: str) -> float:
        return 16 + 7 * math.sqrt(len(members[fid]))

    pos: dict[str, tuple[float, float, float]] = {}
    folder_names = sorted(folders)
    # Folder spheres sized to hold their files without overlap.
    folder_r = {}
    for name in folder_names:
        biggest = max(member_radius(f["id"]) for f in folders[name])
        count = len(folders[name])
        folder_r[name] = 0 if count == 1 else biggest * 1.15 / math.sin(math.pi / max(count, 3)) * 1.25 + 30
    spread = max(folder_r.values()) * 1.6 + 110
    centres = fib_sphere(len(folder_names), spread, twist=0.4)

    for fi, name in enumerate(folder_names):
        group = sorted(folders[name], key=lambda f: f["file_path"])
        spots = fib_sphere(len(group), folder_r[name], twist=fi * 1.3)
        for f, spot in zip(group, spots):
            centre = add(centres[fi], spot)
            pos[f["id"]] = centre
            kids = sorted(members[f["id"]], key=lambda n: n["line_start"])
            for kid, off in zip(kids, fib_sphere(len(kids), member_radius(f["id"]), twist=len(kids) * 0.7)):
                pos[kid["id"]] = add(centre, off if len(kids) > 1 else (member_radius(f["id"]), 0, 0))

    # Externals: just outside the node their edge lands on, pushed away from the origin.
    for n in nodes:
        if n["type"] != "external" or n["id"] in pos:
            continue
        target = next((l["target"] for l in graph["links"] if l["source"] == n["id"]), None)
        base = pos.get(target, (0.0, 0.0, 0.0))
        length = math.sqrt(sum(c * c for c in base)) or 1.0
        pos[n["id"]] = tuple(c + c / length * 70 for c in base)

    # Anything left (should be nothing) goes near the origin.
    for i, n in enumerate(nodes):
        pos.setdefault(n["id"], (i * 3.0, 0.0, 0.0))
    return [{"id": nid, "x": round(p[0], 2), "y": round(p[1], 2), "z": round(p[2], 2)} for nid, p in pos.items() if nid in by_id]


def main(argv: list[str]) -> None:
    src = Path(argv[1] if len(argv) > 1 else "data/graph.json")
    dst = Path(argv[2] if len(argv) > 2 else "data/layout.json")
    layout = build(json.loads(src.read_text()))
    dst.write_text(json.dumps({"nodes": layout}))
    for axis in "xyz":
        values = [n[axis] for n in layout]
        print(f"{axis}: {min(values):.0f} .. {max(values):.0f}")


if __name__ == "__main__":
    main(sys.argv)
