import { useCallback, useEffect, useRef, type RefObject } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import { saveLayout } from "./api";
import { linkKey } from "./tour";
import type { GNode, GraphData } from "./types";

const SIZE: Record<string, number> = { file: 6, class: 4, function: 2, method: 2, external: 5 };

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

function clusterColor(cluster: string): string {
  let hash = 0;
  for (let i = 0; i < cluster.length; i += 1) hash = (hash * 31 + cluster.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360} 42% 64%)`;
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
        return "rgba(120,120,140,0.15)";
      }
      if (node.id === current) return "#ffd400";
      if (path.has(node.id)) return "#36c5ff";
      if (candidates.has(node.id)) return pulse ? "#ff7ad9" : "#36c5ff";
      if (active) return "rgba(120,120,140,0.15)";
      if (node.type === "external") return "#c084fc";
      return clusterColor(node.cluster);
    },
    [active, blast, blastOrigin, bornAt, candidates, current, path, pulse, timeIndex],
  );

  return (
    <ForceGraph3D
      ref={fgRef}
      width={width || undefined}
      height={height || undefined}
      graphData={data}
      nodeLabel="id"
      nodeAutoColorBy="cluster"
      nodeColor={nodeColor as (node: object) => string}
      nodeVal={(node: object) => SIZE[(node as GNode).type] ?? 2}
      nodeVisibility={(node: object) => born((node as GNode).id)}
      linkVisibility={(link: object) => {
        const ends = asLink(link);
        if (!born(endId(ends.source)) || !born(endId(ends.target))) return false;
        const kind = (link as { type?: string }).type;
        return kind === "calls" || kind === "depends";
      }}
      linkColor={(link: object) => (pathLinks.has(linkKey(asLink(link))) ? "#36c5ff" : "rgba(150,150,170,0.2)")}
      linkWidth={(link: object) => (pathLinks.has(linkKey(asLink(link))) ? 2.5 : 0.3)}
      linkDirectionalParticles={(link: object) => (pathLinks.has(linkKey(asLink(link))) ? 4 : 0)}
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
