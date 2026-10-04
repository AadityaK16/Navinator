import type { GLink, GNode, LinkType } from "./types";

// A box in the 2D architecture view: a file, a custom group, or a browser
// entry point. Boxes are drawn as circles in columns, left to right, in the
// order a request travels through them.
export type Box = {
  key: string;
  kind: "file" | "custom" | "entry";
  title: string;
  role: string;
  tech: string[];
  color: string;
  ids: Set<string>;
  // filled in by layout
  layer: number;
  x: number;
  y: number;
  r: number;
};

export type BoxEdge = {
  key: string;
  from: string;
  to: string;
  counts: Partial<Record<LinkType, number>>;
  total: number;
  kind: LinkType; // the most common edge type, used for colour
  path: string; // SVG path, filled in by layout
  span: number;
};

export type Diagram = {
  boxes: Box[];
  edges: BoxEdge[];
  offPath: Box[]; // boxes with no call or depends edge to anything else
  boxOf: Map<string, string>; // node id -> box key
  width: number;
  height: number;
  minX: number;
  minY: number;
};

export type BoxSeed = Omit<Box, "layer" | "x" | "y" | "r">;

const COL_GAP = 215;
const ROW_GAP = 150;
const RADIUS = 52;
const ENTRY_RADIUS = 44;
const CORNER = 12;
const FLOW_TYPES: LinkType[] = ["calls", "depends"];

function endId(end: string | GNode): string {
  return typeof end === "string" ? end : end.id;
}

export function buildDiagram(seeds: BoxSeed[], links: GLink[], hidden: Set<string>): Diagram {
  const boxOf = new Map<string, string>();
  seeds.forEach((box) => box.ids.forEach((id) => boxOf.set(id, box.key)));

  // Collapse node-level calls/depends edges into one edge per pair of boxes.
  const edgeMap = new Map<string, BoxEdge>();
  links.forEach((link) => {
    if (!FLOW_TYPES.includes(link.type)) return;
    const a = endId(link.source);
    const b = endId(link.target);
    if (hidden.has(a) || hidden.has(b)) return;
    const from = boxOf.get(a);
    const to = boxOf.get(b);
    if (!from || !to || from === to) return;
    const key = `${from}=>${to}`;
    const edge = edgeMap.get(key) ?? { key, from, to, counts: {}, total: 0, kind: link.type, path: "", span: 1 };
    edge.counts[link.type] = (edge.counts[link.type] ?? 0) + 1;
    edge.total += 1;
    edgeMap.set(key, edge);
  });
  const edges = [...edgeMap.values()];
  edges.forEach((edge) => {
    edge.kind = (edge.counts.depends ?? 0) > (edge.counts.calls ?? 0) ? "depends" : "calls";
  });

  const connected = new Set<string>();
  edges.forEach((e) => {
    connected.add(e.from);
    connected.add(e.to);
  });
  const placed: Box[] = seeds
    .filter((s) => connected.has(s.key) || s.kind === "custom")
    .map((s) => ({ ...s, layer: 0, x: 0, y: 0, r: s.kind === "entry" ? ENTRY_RADIUS : RADIUS }));
  const offPath: Box[] = seeds
    .filter((s) => !connected.has(s.key) && s.kind !== "custom")
    .map((s) => ({ ...s, layer: 0, x: 0, y: 0, r: RADIUS }));
  const byKey = new Map(placed.map((b) => [b.key, b]));

  // Drop edges that would close a cycle (DFS from entry points first) so the
  // flow always reads left to right.
  const out = new Map<string, BoxEdge[]>();
  edges.forEach((e) => out.set(e.from, [...(out.get(e.from) ?? []), e]));
  const state = new Map<string, number>(); // 1 visiting, 2 done
  const back = new Set<string>();
  const visit = (key: string) => {
    state.set(key, 1);
    for (const e of out.get(key) ?? []) {
      const s = state.get(e.to);
      if (s === 1) back.add(e.key);
      else if (s == null) visit(e.to);
    }
    state.set(key, 2);
  };
  const roots = [...placed].sort((a, b) => Number(b.kind === "entry") - Number(a.kind === "entry"));
  roots.forEach((b) => {
    if (!state.has(b.key)) visit(b.key);
  });
  const forward = edges.filter((e) => !back.has(e.key));

  // Longest-path layering: each box sits one column right of its furthest caller.
  const layer = new Map<string, number>();
  const incoming = new Map<string, BoxEdge[]>();
  forward.forEach((e) => incoming.set(e.to, [...(incoming.get(e.to) ?? []), e]));
  const layerOf = (key: string, seen = new Set<string>()): number => {
    if (layer.has(key)) return layer.get(key)!;
    if (seen.has(key)) return 0;
    seen.add(key);
    const preds = incoming.get(key) ?? [];
    const value = preds.length ? Math.max(...preds.map((e) => layerOf(e.from, seen) + 1)) : 0;
    layer.set(key, value);
    return value;
  };
  placed.forEach((b) => {
    b.layer = layerOf(b.key);
  });
  // Entry points always start the flow; everything else shifts right of them.
  if (placed.some((b) => b.kind === "entry")) {
    placed.forEach((b) => {
      if (b.kind !== "entry" && b.layer === 0) b.layer = 1;
    });
    let changed = true;
    while (changed) {
      changed = false;
      forward.forEach((e) => {
        const a = byKey.get(e.from);
        const b = byKey.get(e.to);
        if (a && b && b.layer <= a.layer) {
          b.layer = a.layer + 1;
          changed = true;
        }
      });
    }
  }

  // Order boxes inside each column by the average position of their
  // neighbours (barycentre), sweeping both ways to cut down crossings.
  const columns = new Map<number, Box[]>();
  placed.forEach((b) => columns.set(b.layer, [...(columns.get(b.layer) ?? []), b]));
  const layers = [...columns.keys()].sort((a, b) => a - b);
  layers.forEach((l) => columns.get(l)!.sort((a, b) => a.title.localeCompare(b.title)));
  const rank = new Map<string, number>();
  const setRanks = () => layers.forEach((l) => columns.get(l)!.forEach((b, i) => rank.set(b.key, i)));
  setRanks();
  const neighbours = (key: string, dir: "in" | "out") =>
    forward.filter((e) => (dir === "in" ? e.to === key : e.from === key)).map((e) => (dir === "in" ? e.from : e.to));
  for (let pass = 0; pass < 8; pass += 1) {
    const order = pass % 2 === 0 ? layers : [...layers].reverse();
    order.forEach((l) => {
      const dir = pass % 2 === 0 ? "in" : "out";
      const col = columns.get(l)!;
      const score = new Map<string, number>();
      col.forEach((b) => {
        const ns = neighbours(b.key, dir);
        score.set(b.key, ns.length ? ns.reduce((sum, n) => sum + (rank.get(n) ?? 0), 0) / ns.length : rank.get(b.key) ?? 0);
      });
      col.sort((a, b) => score.get(a.key)! - score.get(b.key)!);
      col.forEach((b, i) => rank.set(b.key, i));
    });
  }

  // Coordinates: columns left to right, each column centred vertically.
  layers.forEach((l, li) => {
    const col = columns.get(l)!;
    const height = (col.length - 1) * ROW_GAP;
    col.forEach((b, i) => {
      b.x = li * COL_GAP;
      b.y = i * ROW_GAP - height / 2;
    });
  });
  const colIndex = new Map(layers.map((l, i) => [l, i]));

  // Elbow arrows like a hand-drawn architecture diagram. Neighbouring columns
  // get a right angle in the gap; longer jumps get a smooth curve.
  edges.forEach((e) => {
    const a = byKey.get(e.from);
    const b = byKey.get(e.to);
    if (!a || !b) return;
    const sx = a.x + a.r;
    const tx = b.x - b.r - 6;
    const sy = a.y;
    const ty = b.y;
    e.span = (colIndex.get(b.layer) ?? 0) - (colIndex.get(a.layer) ?? 0);
    if (e.span === 1 || Math.abs(ty - sy) < 1) {
      const mid = (sx + tx) / 2;
      if (Math.abs(ty - sy) < 1) {
        e.path = `M${sx},${sy} H${tx}`;
      } else {
        const dir = ty > sy ? 1 : -1;
        const c = Math.min(CORNER, Math.abs(ty - sy) / 2);
        e.path = `M${sx},${sy} H${mid - c} Q${mid},${sy} ${mid},${sy + dir * c} V${ty - dir * c} Q${mid},${ty} ${mid + c},${ty} H${tx}`;
      }
    } else {
      const dx = Math.max(60, (tx - sx) * 0.45);
      e.path = `M${sx},${sy} C${sx + dx},${sy} ${tx - dx},${ty} ${tx},${ty}`;
    }
  });

  const xs = placed.map((b) => b.x);
  const ys = placed.map((b) => b.y);
  const pad = 72;
  const minX = Math.min(...xs, 0) - pad;
  const minY = Math.min(...ys, 0) - pad;
  const maxX = Math.max(...xs, 0) + pad;
  const maxY = Math.max(...ys, 0) + pad + 40;
  return { boxes: placed, edges, offPath, boxOf, width: maxX - minX, height: maxY - minY, minX, minY };
}

// Boxes reachable from one box along the drawn arrows, with hop counts, so a
// "start from" animation can light up the flow in order.
export function reachable(d: Diagram, start: string): Map<string, number> {
  const hops = new Map<string, number>([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const key = queue.shift()!;
    const h = hops.get(key)!;
    d.edges.forEach((e) => {
      if (e.from === key && !hops.has(e.to)) {
        hops.set(e.to, h + 1);
        queue.push(e.to);
      }
    });
  }
  return hops;
}

export function pastel(color: string, amount = 0.55): string {
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return color;
  probe.fillStyle = color;
  const hex = probe.fillStyle as string;
  if (!hex.startsWith("#") || hex.length !== 7) return color;
  const mix = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount) + 255 * amount);
  return `rgb(${mix(1)}, ${mix(3)}, ${mix(5)})`;
}
