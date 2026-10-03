import type { ForceGraphMethods } from "react-force-graph-3d";
import { fetchNode } from "./api";
import type { GNode, NodeDetail, TourStop } from "./types";

type CameraNode = { x?: number; y?: number; z?: number };

export function linkKey(link: { source: string | { id?: string }; target: string | { id?: string } }): string {
  const id = (value: string | { id?: string }) => (typeof value === "string" ? value : value.id ?? "");
  return `${id(link.source)}->${id(link.target)}`;
}

export function flyTo(fg: ForceGraphMethods | undefined, node: CameraNode, ms = 1600): Promise<void> {
  return new Promise((resolve) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const z = node.z ?? 0;
    if (fg) {
      const dist = 90;
      const r = 1 + dist / Math.hypot(x || 1, y || 1, z || 1);
      fg.cameraPosition({ x: x * r, y: y * r, z: z * r }, { x, y, z }, ms);
    }
    window.setTimeout(resolve, ms);
  });
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
