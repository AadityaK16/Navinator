import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import * as THREE from "three";
import { saveLayout } from "./api";
import { buildFileColors, colorForNode } from "./colors";
import { linkKey } from "./tour";
import type { GLink, GNode, GraphData } from "./types";

const SIZE: Record<string, number> = { file: 6, class: 4, function: 2, method: 2, external: 5 };
const REL_SIZE = 4;
const DIM = "rgba(120,120,140,0.15)";

type Props = {
  data: GraphData;
  path: Set<string>;
  pathLinks: Set<string>;
  current: string | null;
  candidates: Set<string>;
  blast: Map<string, number> | null;
  blastOrigin: string | null;
  pulse: boolean;
  // Time machine: snapshot index each node arrived at, and the snapshot on screen (null = today).
  bornAt: Map<string, number> | null;
  timeIndex: number | null;
  onClick: (node: GNode) => void;
  onReady: () => void;
  fgRef: RefObject<ForceGraphMethods | undefined>;
  width?: number;
  height?: number;
};

function asLink(link: object): { source: string | { id?: string }; target: string | { id?: string } } {
  return link as { source: string | { id?: string }; target: string | { id?: string } };
}

function endId(end: string | { id?: string }): string {
  return typeof end === "string" ? end : end.id ?? "";
}

function radius(node: GNode): number {
  return Math.cbrt(SIZE[node.type] ?? 2) * REL_SIZE;
}

// A text sprite drawn on a canvas, so file names float above their node.
function makeLabel(text: string, color: string, faded: boolean, below: boolean): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = "600 44px 'Segoe UI', 'Helvetica Neue', sans-serif";
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width) + 36;
  canvas.width = width;
  canvas.height = 72;
  ctx.font = font;
  ctx.fillStyle = "rgba(5,6,10,0.78)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(2, 2, width - 4, 68, 16);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f4f5fa";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 18, 38);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // sizeAttenuation off keeps the tag the same size on screen at any zoom,
  // so file names stay readable in the overview without crowding close-ups.
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: faded ? 0.1 : 0.95,
    depthWrite: false,
    depthTest: false,
    sizeAttenuation: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 10;
  const height = 0.021;
  sprite.scale.set((width / 72) * height, height, 1);
  sprite.center.set(0.5, below ? 1 : 0);
  return sprite;
}

export function Graph3D({
  data,
  path,
  pathLinks,
  current,
  candidates,
  blast,
  blastOrigin,
  pulse,
  bornAt,
  timeIndex,
  onClick,
  onReady,
  fgRef,
  width,
  height,
}: Props) {
  const signaled = useRef(false);
  const positioned = data.nodes.some((node) => node.fx != null);
  const active = path.size > 0;

  const signal = useCallback(() => {
    if (signaled.current) return;
    signaled.current = true;
    onReady();
  }, [onReady]);

  useEffect(() => {
    if (positioned) signal();
  }, [positioned, signal]);

  // Every file gets its own colour and its classes and functions share it, so each
  // file reads as a cluster of code.
  const fileColors = useMemo(() => buildFileColors(data.nodes), [data]);

  // Neighbouring files in the same row alternate label above / below so the
  // tags do not collide in the frozen layout.
  const labelBelow = useMemo(() => {
    const rows = new Map<number, GNode[]>();
    data.nodes
      .filter((n) => n.type === "file")
      .forEach((n) => {
        const key = Math.round((n.fy ?? n.y ?? 0) / 20);
        rows.set(key, [...(rows.get(key) ?? []), n]);
      });
    const below = new Set<string>();
    rows.forEach((row) => {
      row
        .sort((a, b) => (a.fx ?? a.x ?? 0) - (b.fx ?? b.x ?? 0))
        .forEach((n, i) => {
          if (i % 2 === 1) below.add(n.id);
        });
    });
    return below;
  }, [data]);

  const faded = useCallback(
    (node: GNode) => {
      if (blast) return node.id !== blastOrigin && !blast.has(node.id);
      if (active) return node.id !== current && !path.has(node.id) && !candidates.has(node.id);
      return false;
    },
    [active, blast, blastOrigin, candidates, current, path],
  );

  const born = useCallback(
    (id: string) => {
      if (!bornAt || timeIndex == null) return true;
      const at = bornAt.get(id);
      return at == null || at <= timeIndex;
    },
    [bornAt, timeIndex],
  );

  const nodeColor = useCallback(
    (node: GNode) => {
      if (bornAt && timeIndex != null && bornAt.get(node.id) === timeIndex) return "#4ade80";
      if (blast) {
        if (node.id === blastOrigin) return "#ffd400";
        const distance = blast.get(node.id);
        if (distance === 1) return "#ff4d4d";
        if (distance === 2) return "#ff8a3d";
        if (distance === 3) return "#ffd400";
        return DIM;
      }
      if (node.id === current) return "#ffd400";
      if (path.has(node.id)) return "#36c5ff";
      if (candidates.has(node.id)) return pulse ? "#ff7ad9" : "#36c5ff";
      if (active) return DIM;
      return colorForNode(node, fileColors);
    },
    [active, blast, blastOrigin, bornAt, candidates, current, fileColors, path, pulse, timeIndex],
  );

  // Depth cues on top of the default sphere: files get a thick outline shell in their
  // file colour and a floating name tag, classes a thinner ring, functions stay plain,
  // so the three levels (file, class, function) read at a glance.
  const nodeObject = useCallback(
    (node: GNode) => {
      if (node.type !== "file" && node.type !== "class") return undefined as unknown as THREE.Object3D;
      const group = new THREE.Group();
      const fade = faded(node);
      const color = new THREE.Color(colorForNode(node, fileColors));
      const r = radius(node);
      if (node.type === "file") {
        const shell = new THREE.Mesh(
          new THREE.SphereGeometry(r * 1.5, 40, 28),
          new THREE.MeshBasicMaterial({
            color: color.clone().lerp(new THREE.Color(0xffffff), 0.35),
            side: THREE.BackSide,
            transparent: true,
            opacity: fade ? 0.04 : 0.95,
            depthWrite: false,
          }),
        );
        group.add(shell);
        const below = labelBelow.has(node.id);
        const name = node.label === "__init__.py" ? `${node.module.split(".").pop()}/` : node.label.replace(/\.py$/, "");
        const label = makeLabel(name, `#${color.getHexString()}`, fade, below);
        label.position.set(0, below ? -(r * 1.5 + 1) : r * 1.5 + 1, 0);
        group.add(label);
      } else {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(r * 1.35, 0.35, 8, 40),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: fade ? 0.04 : 0.7, depthWrite: false }),
        );
        group.add(ring);
      }
      return group;
    },
    [faded, fileColors, labelBelow],
  );

  const onPath = useCallback((link: object) => pathLinks.has(linkKey(asLink(link))), [pathLinks]);
  const linkColor = useCallback((link: object) => (onPath(link) ? "#36c5ff" : "rgba(150,150,170,0.2)"), [onPath]);

  return (
    <ForceGraph3D
      ref={fgRef}
      width={width || undefined}
      height={height || undefined}
      graphData={data}
      nodeLabel={(node: object) => {
        const n = node as GNode;
        return n.type === "external" ? n.id : `${n.id}<br/><span style="opacity:.7">${n.file_path}:${n.line_start}</span>`;
      }}
      nodeColor={nodeColor as (node: object) => string}
      nodeVal={(node: object) => SIZE[(node as GNode).type] ?? 2}
      nodeRelSize={REL_SIZE}
      nodeResolution={20}
      nodeThreeObject={nodeObject as (node: object) => THREE.Object3D}
      nodeThreeObjectExtend
      nodeVisibility={(node: object) => born((node as GNode).id)}
      linkVisibility={(link: object) => {
        const ends = asLink(link);
        if (!born(endId(ends.source)) || !born(endId(ends.target))) return false;
        const kind = (link as { type?: string }).type;
        return kind === "calls" || kind === "depends";
      }}
      linkColor={linkColor}
      linkWidth={(link: object) => (onPath(link) ? 2.5 : 0.3)}
      linkLabel={(link: object) => {
        const l = link as GLink;
        return l.line ? `${l.type} · line ${l.line}` : l.type;
      }}
      linkDirectionalArrowLength={3}
      linkDirectionalArrowRelPos={0.92}
      linkDirectionalArrowColor={linkColor}
      linkDirectionalParticles={(link: object) => (onPath(link) ? 4 : 0)}
      linkDirectionalParticleWidth={3}
      cooldownTicks={positioned ? 0 : 300}
      warmupTicks={positioned ? 0 : undefined}
      onEngineStop={() => {
        if (positioned) {
          signal();
          return;
        }
        data.nodes.forEach((node) => {
          node.fx = node.x;
          node.fy = node.y;
          node.fz = node.z;
        });
        void saveLayout(
          data.nodes.map((node) => ({
            id: node.id,
            x: node.x ?? 0,
            y: node.y ?? 0,
            z: node.z ?? 0,
          })),
        );
        signal();
      }}
      onNodeClick={(node) => onClick(node as GNode)}
      backgroundColor="#05060a"
      showNavInfo={false}
    />
  );
}
