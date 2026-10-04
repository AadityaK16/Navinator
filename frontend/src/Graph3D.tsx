import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import * as THREE from "three";
import { saveLayout } from "./api";
import { EDGE_STYLE, colorForNode, withAlpha } from "./colors";
import { linkKey } from "./tour";
import type { GLink, GNode, GraphData, LinkType } from "./types";

const SIZE: Record<string, number> = { file: 6, class: 4, function: 2, method: 2, external: 5 };
const REL_SIZE = 4;
const DIM = "rgba(120,120,140,0.15)";
const EDGE_WIDTH: Record<string, number> = { calls: 1.4, depends: 1.4, imports: 1, contains: 0.8 };

export type GraphGrouping = {
  groups: { key: string; name: string; color: string; members: string[] }[];
  hidden: Set<string>;
};

type Props = {
  data: GraphData;
  path: Set<string>;
  pathLinks: Set<string>;
  current: string | null;
  candidates: Set<string>;
  blast: Map<string, number> | null;
  blastOrigin: string | null;
  pulse: boolean;
  fileColors: Map<string, string>;
  edgeTypes: Set<LinkType>;
  bornAt: Map<string, number> | null;
  timeIndex: number | null;
  focus: Set<string> | null;
  grouping: GraphGrouping | null;
  onClick: (node: GNode) => void;
  onReady: () => void;
  fgRef: RefObject<ForceGraphMethods | undefined>;
};

function endpoints(link: object): { source: string | { id?: string }; target: string | { id?: string } } {
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
  fileColors,
  edgeTypes,
  bornAt,
  timeIndex,
  focus,
  grouping,
  onClick,
  onReady,
  fgRef,
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

  // Labels sit above their node; the 3D layout keeps file nodes well apart.
  const labelBelow = useMemo(() => new Set<string>(), []);

  const born = useCallback(
    (id: string) => {
      if (!bornAt || timeIndex == null) return true;
      const at = bornAt.get(id);
      return at == null || at <= timeIndex;
    },
    [bornAt, timeIndex],
  );

  const isNew = useCallback(
    (id: string) => bornAt != null && timeIndex != null && bornAt.get(id) === timeIndex,
    [bornAt, timeIndex],
  );

  // Custom groupings recolour nodes by group; the original view colours by file.
  const groupColors = useMemo(() => {
    const map = new Map<string, string>();
    grouping?.groups.forEach((g) => g.members.forEach((id) => map.set(id, g.color)));
    return map;
  }, [grouping]);

  const baseColor = useCallback(
    (node: GNode) => (grouping ? groupColors.get(node.id) ?? "#6b7080" : colorForNode(node, fileColors)),
    [fileColors, groupColors, grouping],
  );

  const visible = useCallback(
    (id: string) => {
      if (!born(id)) return false;
      if (grouping && grouping.hidden.has(id)) return path.has(id) || id === current;
      return true;
    },
    [born, current, grouping, path],
  );

  const faded = useCallback(
    (node: GNode) => {
      if (blast) return node.id !== blastOrigin && !blast.has(node.id);
      if (active) return node.id !== current && !path.has(node.id) && !candidates.has(node.id);
      if (focus) return !focus.has(node.id);
      return false;
    },
    [active, blast, blastOrigin, candidates, current, focus, path],
  );

  const nodeColor = useCallback(
    (node: GNode) => {
      if (isNew(node.id)) return "#4ade80";
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
      if (focus && !focus.has(node.id)) return DIM;
      return baseColor(node);
    },
    [active, baseColor, blast, blastOrigin, candidates, current, focus, isNew, path, pulse],
  );

  // Extra geometry added on top of the default sphere. File nodes get a thick
  // outline shell in their file colour and a floating name tag; classes get a
  // thinner ring so the three levels (file, class, function) read at a glance.
  const nodeObject = useCallback(
    (node: GNode) => {
      if (node.type !== "file" && node.type !== "class") return undefined as unknown as THREE.Object3D;
      const group = new THREE.Group();
      const fade = faded(node);
      const color = new THREE.Color(baseColor(node));
      const r = radius(node);
      if (node.type === "file") {
        const rim = color.clone().lerp(new THREE.Color(0xffffff), 0.35);
        const shell = new THREE.Mesh(
          new THREE.SphereGeometry(r * 1.5, 40, 28),
          new THREE.MeshBasicMaterial({
            color: rim,
            side: THREE.BackSide,
            transparent: true,
            opacity: fade ? 0.04 : 0.95,
            depthWrite: false,
          }),
        );
        group.add(shell);
        if (grouping) return group;
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
    [baseColor, faded, grouping, labelBelow],
  );

  const pathColor = useCallback((link: object) => pathLinks.has(linkKey(endpoints(link))), [pathLinks]);

  const linkColor = useCallback(
    (link: object) => {
      if (pathColor(link)) return "#36c5ff";
      const kind = (link as GLink).type;
      const base = EDGE_STYLE[kind]?.color ?? "#9696aa";
      if (blast || active) return withAlpha(base, 0.08);
      if (focus) {
        const ends = endpoints(link);
        const inside = [focus.has(endId(ends.source)), focus.has(endId(ends.target))].filter(Boolean).length;
        if (inside === 0) return withAlpha(base, 0.05);
        if (inside === 1) return withAlpha(base, 0.45);
      }
      return withAlpha(base, kind === "contains" ? 0.55 : 0.85);
    },
    [active, blast, focus, pathColor],
  );

  const graphData = useMemo(() => data, [data]);

  // Faint bubbles around each group so groups read as places in space. In the
  // original view a group is a file (anchored on the file node); in a custom
  // grouping it is one of the AI's groups, with a name tag above it.
  type BubbleSpec = { key: string; color: string; members: GNode[]; anchor: GNode | null; label: string | null };
  const specs = useMemo<BubbleSpec[]>(() => {
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    if (grouping) {
      return grouping.groups.map((g) => ({
        key: g.key,
        color: g.color,
        members: g.members.map((id) => byId.get(id)).filter((n): n is GNode => Boolean(n)),
        anchor: null,
        label: g.name,
      }));
    }
    const byFile = new Map<string, GNode[]>();
    data.nodes.forEach((n) => {
      if (n.type === "external" || !n.file_path) return;
      byFile.set(n.file_path, [...(byFile.get(n.file_path) ?? []), n]);
    });
    return [...byFile.entries()].map(([file, members]) => ({
      key: file,
      color: fileColors.get(file) ?? "#9aa0b4",
      members,
      anchor: members.find((n) => n.type === "file") ?? null,
      label: null,
    }));
  }, [data, fileColors, grouping]);

  type Bubble = { mesh: THREE.Mesh; label: THREE.Sprite | null; spec: BubbleSpec };
  const bubbles = useRef<Bubble[]>([]);

  const placeBubbles = useCallback(() => {
    bubbles.current.forEach(({ mesh, label, spec }) => {
      const members = spec.members;
      if (members.length === 0) return;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      if (spec.anchor) {
        cx = spec.anchor.x ?? 0;
        cy = spec.anchor.y ?? 0;
        cz = spec.anchor.z ?? 0;
      } else {
        members.forEach((n) => {
          cx += n.x ?? 0;
          cy += n.y ?? 0;
          cz += n.z ?? 0;
        });
        cx /= members.length;
        cy /= members.length;
        cz /= members.length;
      }
      let r = 0;
      members.forEach((n) => {
        r = Math.max(r, Math.hypot((n.x ?? 0) - cx, (n.y ?? 0) - cy, (n.z ?? 0) - cz));
      });
      const size = Math.max(r + 9, 16);
      mesh.position.set(cx, cy, cz);
      mesh.scale.setScalar(size);
      label?.position.set(cx, cy + size + 2, cz);
    });
  }, []);

  const [sceneTick, setSceneTick] = useState(0);
  useEffect(() => {
    const scene = fgRef.current?.scene();
    if (!scene) {
      const retry = window.setTimeout(() => setSceneTick((t) => t + 1), 120);
      return () => window.clearTimeout(retry);
    }
    const made: Bubble[] = specs.map((spec) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 32, 20),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(spec.color),
          transparent: true,
          opacity: spec.label ? 0.07 : 0.045,
          depthWrite: false,
        }),
      );
      mesh.renderOrder = -1;
      scene.add(mesh);
      let label: THREE.Sprite | null = null;
      if (spec.label) {
        label = makeLabel(spec.label, spec.color, false, false);
        label.scale.multiplyScalar(1.25);
        scene.add(label);
      }
      return { mesh, label, spec };
    });
    bubbles.current = made;
    placeBubbles();
    // Follow nodes every frame: regroup animations and drags both move them.
    let frame = requestAnimationFrame(function loop() {
      placeBubbles();
      frame = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(frame);
      made.forEach(({ mesh, label }) => {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        if (label) {
          scene.remove(label);
          (label.material as THREE.SpriteMaterial).map?.dispose();
          label.material.dispose();
        }
      });
    };
  }, [fgRef, placeBubbles, sceneTick, specs]);

  useEffect(() => {
    const dimmed = blast != null || active;
    bubbles.current.forEach(({ mesh, label, spec }) => {
      const material = mesh.material as THREE.MeshBasicMaterial;
      const inFocus = focus != null && spec.members.some((n) => focus.has(n.id));
      const shown = spec.members.some((n) => visible(n.id));
      mesh.visible = shown;
      const base = spec.label ? 0.07 : 0.045;
      material.opacity = dimmed ? 0.012 : focus ? (inFocus ? 0.11 : 0.012) : base;
      if (label) {
        label.visible = shown;
        label.material.opacity = dimmed || (focus && !inFocus) ? 0.12 : 0.95;
      }
    });
  }, [active, blast, focus, sceneTick, specs, visible]);

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={graphData}
      nodeLabel={(node: object) => {
        const n = node as GNode;
        return `${n.id}<br/><span style="opacity:.7">${n.file_path}:${n.line_start}</span>`;
      }}
      nodeColor={nodeColor as (node: object) => string}
      nodeVal={(node: object) => SIZE[(node as GNode).type] ?? 2}
      nodeRelSize={REL_SIZE}
      nodeResolution={20}
      nodeThreeObject={nodeObject as (node: object) => THREE.Object3D}
      nodeThreeObjectExtend
      nodeVisibility={(node: object) => visible((node as GNode).id)}
      linkVisibility={(link: object) => {
        const ends = endpoints(link);
        if (!visible(endId(ends.source)) || !visible(endId(ends.target))) return false;
        if (pathColor(link)) return true;
        return edgeTypes.has((link as GLink).type);
      }}
      linkLabel={(link: object) => {
        const l = link as GLink;
        const where = l.line ? ` · line ${l.line}` : "";
        return `${EDGE_STYLE[l.type]?.label ?? l.type}${where}`;
      }}
      linkColor={linkColor}
      linkWidth={(link: object) => {
        if (pathColor(link)) return 2.5;
        if (blast || active) return 0.4;
        return EDGE_WIDTH[(link as GLink).type] ?? 1;
      }}
      linkDirectionalArrowLength={(link: object) => {
        const kind = (link as GLink).type;
        return kind === "calls" || kind === "depends" ? 3 : 0;
      }}
      linkDirectionalArrowRelPos={0.92}
      linkDirectionalArrowColor={linkColor}
      linkDirectionalParticles={(link: object) => (pathColor(link) ? 4 : 0)}
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
      onNodeDragEnd={(node) => {
        const n = node as GNode;
        n.fx = n.x;
        n.fy = n.y;
        n.fz = n.z;
      }}
      backgroundColor="#05060a"
      showNavInfo={false}
    />
  );
}
