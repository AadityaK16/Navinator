import type { ForceGraphMethods } from "react-force-graph-3d";
import { fetchNode } from "./api";
import type { GNode, NodeDetail, TourStop } from "./types";

type CameraNode = { x?: number; y?: number; z?: number };

export function linkKey(link: { source: string | { id?: string }; target: string | { id?: string } }): string {
  const id = (value: string | { id?: string }) => (typeof value === "string" ? value : value.id ?? "");
  return `${id(link.source)}->${id(link.target)}`;
}

export function flyTo(fg: ForceGraphMethods | undefined, node: CameraNode, ms = 1600, dist = 180): Promise<void> {
  return new Promise((resolve) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const z = node.z ?? 0;
    if (fg) {
      const r = 1 + dist / Math.hypot(x || 1, y || 1, z || 1);
      fg.cameraPosition({ x: x * r, y: y * r, z: z * r }, { x, y, z }, ms);
    }
    window.setTimeout(resolve, ms);
  });
}

// Frame a set of nodes: fly to their centre, keep the current viewing angle,
// and back off far enough that the whole set fits on screen.
export function frameNodes(fg: ForceGraphMethods | undefined, nodes: CameraNode[], ms = 1100, room = 1): void {
  if (!fg || nodes.length === 0) return;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  nodes.forEach((n) => {
    cx += n.x ?? 0;
    cy += n.y ?? 0;
    cz += n.z ?? 0;
  });
  cx /= nodes.length;
  cy /= nodes.length;
  cz /= nodes.length;
  let radius = 0;
  nodes.forEach((n) => {
    radius = Math.max(radius, Math.hypot((n.x ?? 0) - cx, (n.y ?? 0) - cy, (n.z ?? 0) - cz));
  });
  const camera = fg.camera() as unknown as { position: { x: number; y: number; z: number }; fov?: number };
  let dx = camera.position.x - cx;
  let dy = camera.position.y - cy;
  let dz = camera.position.z - cz;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  const fov = ((camera.fov ?? 50) * Math.PI) / 180;
  const distance = Math.max(340, ((radius + 40) / Math.tan(fov / 2)) * room);
  fg.cameraPosition({ x: cx + dx * distance, y: cy + dy * distance, z: cz + dz * distance }, { x: cx, y: cy, z: cz }, ms);
}

export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === "undefined") {
      resolve();
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    const local = speechSynthesis.getVoices().find((voice) => voice.localService);
    if (local) utterance.voice = local;
    const cap = window.setTimeout(done, 8000);
    utterance.onend = () => {
      window.clearTimeout(cap);
      done();
    };
    utterance.onerror = () => {
      window.clearTimeout(cap);
      done();
    };
    speechSynthesis.speak(utterance);
    window.setTimeout(() => {
      if (!speechSynthesis.speaking) done();
    }, 400);
  });
}

export async function playTour(
  fg: ForceGraphMethods | undefined,
  nodesById: Record<string, GNode>,
  stops: TourStop[],
  setCurrent: (node: NodeDetail) => void,
  cancelled: () => boolean,
): Promise<void> {
  for (const stop of stops) {
    if (cancelled()) return;
    const placed = nodesById[stop.node_id];
    const detail = await fetchNode(stop.node_id);
    if (cancelled()) return;
    setCurrent({ ...detail, evidence: stop.evidence, narration: stop.narration });
    await Promise.all([flyTo(fg, placed ?? {}, 1600), speak(stop.narration)]);
    if (cancelled()) return;
    await new Promise((resolve) => window.setTimeout(resolve, 400));
  }
}
