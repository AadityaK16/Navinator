import type { ForceGraphMethods } from "react-force-graph-3d";
import type { GNode, RegroupResult } from "./types";

export type Vec = { x: number; y: number; z: number };

export type CustomGroup = { key: string; name: string; why: string; members: string[]; color: string };

export type Grouping = {
  id: string;
  title: string;
  prompt: string;
  summary: string;
  source: string;
  note?: string;
  groups: CustomGroup[]; // empty for the original folders and files view
  hidden: Set<string>;
  positions: Map<string, Vec>;
};

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function fibSphere(count: number, radius: number, twist = 0): Vec[] {
  if (count === 1) return [{ x: 0, y: 0, z: 0 }];
  const points: Vec[] = [];
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN * i + twist;
    points.push({ x: Math.cos(theta) * ring * radius, y: y * radius, z: Math.sin(theta) * ring * radius });
  }
  return points;
}

export function groupColor(index: number): string {
  const hue = Math.round((index * 137.508 + 25) % 360);
  return `hsl(${hue}, 80%, ${index % 2 === 0 ? 64 : 72}%)`;
}

// Same idea as the backend's layout3d: each group gets its own region of
// space, and its members sit on a sphere around the group's centre. Members
// are ordered by file and line so code from one file stays together.
export function layoutGroups(groups: CustomGroup[], nodesById: Record<string, GNode>, fallback: Map<string, Vec>): Map<string, Vec> {
  const positions = new Map<string, Vec>(fallback);
  const radiusOf = (count: number) => 18 + 9 * Math.sqrt(count);
  const biggest = Math.max(...groups.map((g) => radiusOf(g.members.length)), 20);
  const spread = groups.length <= 1 ? 0 : (biggest * 1.7) / Math.sin(Math.PI / Math.max(groups.length, 3)) + 110;
  const centres = fibSphere(groups.length, spread, 0.6);
  groups.forEach((group, gi) => {
    const members = [...group.members].sort((a, b) => {
      const na = nodesById[a];
      const nb = nodesById[b];
      if (!na || !nb) return 0;
      return na.file_path === nb.file_path ? na.line_start - nb.line_start : na.file_path.localeCompare(nb.file_path);
    });
    const spots = fibSphere(members.length, radiusOf(members.length), gi * 1.1);
    members.forEach((id, mi) => {
      const c = centres[gi];
      const s = members.length === 1 ? { x: 0, y: 0, z: 0 } : spots[mi];
      positions.set(id, { x: c.x + s.x, y: c.y + s.y, z: c.z + s.z });
    });
  });
  return positions;
}

export function fromResult(id: string, prompt: string, result: RegroupResult, nodesById: Record<string, GNode>, original: Map<string, Vec>): Grouping {
  const groups = result.groups.map((g, i) => ({
    key: `${id}:${i}`,
    name: g.name,
    why: g.why,
    members: g.members.filter((m) => nodesById[m]),
    color: groupColor(i),
  }));
  return {
    id,
    title: result.title,
    prompt,
    summary: result.summary,
    source: result.source,
    note: result.note,
    groups,
    hidden: new Set(result.hidden),
    positions: layoutGroups(groups, nodesById, original),
  };
}

let animation = 0;

// Move every node to its target over `ms`. The engine is nudged each frame so
// links and labels follow; it stops again on its own right after.
export function animateTo(fg: ForceGraphMethods | undefined, nodes: GNode[], targets: Map<string, Vec>, ms = 1100): Promise<void> {
  animation += 1;
  const mine = animation;
  const starts = new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 }]));
  const begin = performance.now();
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  return new Promise((resolve) => {
    const step = (now: number) => {
      if (mine !== animation) {
        resolve();
        return;
      }
      const t = Math.min(1, (now - begin) / ms);
      const k = ease(t);
      nodes.forEach((n) => {
        const from = starts.get(n.id);
        const to = targets.get(n.id);
        if (!from || !to) return;
        n.x = from.x + (to.x - from.x) * k;
        n.y = from.y + (to.y - from.y) * k;
        n.z = from.z + (to.z - from.z) * k;
        n.fx = n.x;
        n.fy = n.y;
        n.fz = n.z;
      });
      fg?.d3ReheatSimulation();
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}
