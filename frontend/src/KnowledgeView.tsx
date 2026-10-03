import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import { KnowledgeDetail, ShapeIcon } from "./KnowledgeDetail";
import { INK, KIND, KIND_ORDER, drawMark } from "./knowledgeStyle";
import type { GNode, KLink, KNode, KnowledgeData, KnowledgeKind } from "./types";

type Node = NodeObject<KNode>;
type Link = LinkObject<KNode, KLink>;
type End = string | number | Node | undefined;

const FONT = '"Segoe UI", "Helvetica Neue", sans-serif';
const MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

function idOf(end: End): string {
  return typeof end === "object" ? end.id : String(end);
}

type Props = {
  data: KnowledgeData;
  codeNodes: Record<string, GNode>;
  onOpenCode: (id: string) => void;
};

export function KnowledgeView({ data, codeNodes, onOpenCode }: Props) {
  const fgRef = useRef<ForceGraphMethods<Node, Link> | undefined>(undefined);
  const fade = useRef(new Map<string, number>());
  const fitted = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [cluster, setCluster] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<KnowledgeKind>>(new Set());
  const [query, setQuery] = useState("");

  // The force engine mutates link ends into objects, so it gets copies and the panel keeps string ids.
  const graphData = useMemo(
    () => ({ nodes: data.nodes.map((node) => ({ ...node })), links: data.links.map((link) => ({ ...link })) }),
    [data],
  );
  const byId = useMemo(() => new Map(graphData.nodes.map((node) => [node.id, node])), [graphData]);
  const clusterLabel = useMemo(() => new Map(data.clusters.map((c) => [c.id, c.label])), [data]);
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of data.links) {
      const s = String(link.source);
      const t = String(link.target);
      if (!map.has(s)) map.set(s, new Set());
      if (!map.has(t)) map.set(t, new Set());
      map.get(s)!.add(t);
      map.get(t)!.add(s);
    }
    return map;
  }, [data]);

  const focusId = selected ?? hovered;
  const focus = useMemo(() => {
    if (focusId) return new Set([focusId, ...(neighbors.get(focusId) ?? [])]);
    if (cluster) return new Set(data.nodes.filter((node) => node.cluster === cluster).map((node) => node.id));
    return null;
  }, [cluster, data, focusId, neighbors]);

  const visible = useCallback((node: KNode | undefined) => node != null && !hidden.has(node.kind), [hidden]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const ids = data.clusters.map((c) => c.id);
    const centers = new Map(
      ids.map((id, i) => {
        const angle = (i / ids.length) * 2 * Math.PI - Math.PI / 2;
        return [id, { x: Math.cos(angle) * 260, y: Math.sin(angle) * 190 }];
      }),
    );
    let nodes: Node[] = [];
    const pull = Object.assign(
      (alpha: number) => {
        for (const node of nodes) {
          const center = centers.get(node.cluster);
          if (!center) continue;
          node.vx = (node.vx ?? 0) + (center.x - (node.x ?? 0)) * 0.12 * alpha;
          node.vy = (node.vy ?? 0) + (center.y - (node.y ?? 0)) * 0.12 * alpha;
        }
      },
      { initialize: (next: Node[]) => { nodes = next; } },
    );
    // Keeps label room around each mark; 50 nodes makes the pairwise loop cheap.
    const room = (node: Node) => KIND[node.kind].size + (node.kind === "topic" || node.kind === "architecture" ? 26 : 10);
    const collide = Object.assign(
      () => {
        for (let i = 0; i < nodes.length; i += 1) {
          for (let j = i + 1; j < nodes.length; j += 1) {
            const a = nodes[i];
            const b = nodes[j];
            const dx = (b.x ?? 0) - (a.x ?? 0);
            const dy = (b.y ?? 0) - (a.y ?? 0);
            const dist = Math.hypot(dx, dy) || 0.01;
            const min = room(a) + room(b);
            if (dist >= min) continue;
            const push = ((min - dist) / dist) * 0.35;
            a.vx = (a.vx ?? 0) - dx * push;
            a.vy = (a.vy ?? 0) - dy * push;
            b.vx = (b.vx ?? 0) + dx * push;
            b.vy = (b.vy ?? 0) + dy * push;
          }
        }
      },
      { initialize: () => {} },
    );
    fg.d3Force("collide", collide);
    // Links inside a cluster hold it together; links across clusters are long and loose.
    const sameCluster = (link: Link) =>
      byId.get(idOf(link.source))?.cluster === byId.get(idOf(link.target))?.cluster;
    fg.d3Force("cluster", pull);
    fg.d3Force("charge")?.strength(-190);
    fg.d3Force("link")
      ?.distance((link: Link) => (sameCluster(link) ? 32 : 90))
      .strength((link: Link) => (sameCluster(link) ? 0.5 : 0.04));
    fg.d3ReheatSimulation();
  }, [byId, data]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const select = useCallback(
    (id: string) => {
      setSelected(id);
      setCluster(null);
      const node = byId.get(id);
      const fg = fgRef.current;
      if (!node || !fg || node.x == null || node.y == null) return;
      fg.centerAt(node.x, node.y, 600);
      if (fg.zoom() < 2) fg.zoom(2.2, 600);
    },
    [byId],
  );

  function zoomToCluster(id: string) {
    setSelected(null);
    setCluster(id);
    fgRef.current?.zoomToFit(700, 90, (node) => node.cluster === id && visible(node));
  }

  function showAll() {
    setSelected(null);
    setCluster(null);
    setQuery("");
    fgRef.current?.zoomToFit(700, 60, (node) => visible(node));
  }

  function toggleKind(kind: KnowledgeKind) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
    if (selected && byId.get(selected)?.kind === kind) setSelected(null);
  }

  const counts = useMemo(() => {
    const map = new Map<KnowledgeKind, number>();
    for (const node of data.nodes) map.set(node.kind, (map.get(node.kind) ?? 0) + 1);
    return map;
  }, [data]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return data.nodes
      .filter((node) => visible(node) && `${node.title} ${node.summary}`.toLowerCase().includes(q))
      .sort((a, b) => Number(b.title.toLowerCase().includes(q)) - Number(a.title.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [data, query, visible]);

  function linkState(link: Link): "on" | "off" | "rest" {
    const s = idOf(link.source);
    const t = idOf(link.target);
    if (focusId) return s === focusId || t === focusId ? "on" : "off";
    if (focus) return focus.has(s) && focus.has(t) ? "on" : "off";
    return "rest";
  }

  function linkColor(link: Link): string {
    const state = linkState(link);
    const rgb = link.verified ? "231,232,238" : "154,160,180";
    const alpha = state === "on" ? 0.85 : state === "off" ? 0.05 : link.verified ? 0.28 : 0.2;
    return `rgba(${rgb},${alpha})`;
  }

  const paintNode = (node: Node, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const target = !focus || focus.has(node.id) ? 1 : 0.12;
    const previous = fade.current.get(node.id) ?? target;
    const alpha = previous + (target - previous) * 0.18;
    fade.current.set(node.id, alpha);
    ctx.globalAlpha = alpha;
    drawMark(ctx, node.kind, x, y, node.id === selected);

    const prominent = node.kind === "topic" || node.kind === "architecture";
    const inFocus = focus?.has(node.id) ?? false;
    if (alpha > 0.5 && (prominent || inFocus || scale > 1.8)) {
      const px = node.kind === "topic" ? 12.5 : 11;
      const family = node.kind === "function" ? MONO : FONT;
      ctx.font = `${node.kind === "topic" ? 650 : 500} ${px / scale}px ${family}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const labelY = y + KIND[node.kind].size + 4 / scale + 1;
      // A background-colored halo keeps labels readable where edges pass behind them.
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = "#05060a";
      ctx.strokeText(node.title, x, labelY);
      ctx.fillStyle = node.id === focusId || node.kind === "topic" ? INK.primary : INK.secondary;
      ctx.fillText(node.title, x, labelY);
    }
    ctx.globalAlpha = 1;
  };

  const selectedNode = selected ? byId.get(selected) : undefined;

  return (
    <div className="kg">
      <ForceGraph2D<KNode, KLink>
        ref={fgRef}
        graphData={graphData}
        backgroundColor="#05060a"
        autoPauseRedraw={false}
        warmupTicks={160}
        cooldownTime={2500}
        onEngineStop={() => {
          if (fitted.current) return;
          fitted.current = true;
          fgRef.current?.zoomToFit(600, 60);
        }}
        nodeLabel={() => ""}
        nodeVisibility={(node) => visible(node)}
        linkVisibility={(link) => visible(byId.get(idOf(link.source))) && visible(byId.get(idOf(link.target)))}
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={(node, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, KIND[node.kind].size + 2.5, 0, 2 * Math.PI);
          ctx.fill();
        }}
        linkColor={linkColor}
        linkWidth={(link) => (linkState(link) === "on" ? 1.6 : 0.8)}
        linkLineDash={(link) => (link.verified ? null : [3, 3])}
        linkDirectionalArrowLength={(link) => (link.verified ? 3.5 : 0)}
        linkDirectionalArrowRelPos={1}
        linkDirectionalParticles={(link) => (link.verified && linkState(link) === "on" ? 2 : 0)}
        linkDirectionalParticleWidth={2}
        linkDirectionalParticleSpeed={0.006}
        linkDirectionalParticleColor={() => INK.primary}
        onNodeHover={(node) => setHovered(node ? node.id : null)}
        onNodeClick={(node) => select(node.id)}
        onBackgroundClick={() => setSelected(null)}
      />

      <aside className="kg-controls">
        <p className="kicker">Knowledge</p>
        <input
          aria-label="Search concepts"
          value={query}
          placeholder="Search concepts, decisions, functions"
          onChange={(event) => setQuery(event.target.value)}
        />
        {matches.length > 0 && (
          <ul className="hits">
            {matches.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  className="hit kg-hit"
                  onClick={() => {
                    setQuery("");
                    select(node.id);
                  }}
                >
                  <span className="kg-other">
                    <ShapeIcon kind={node.kind} /> {node.title}
                  </span>
                  <small>{KIND[node.kind].label} · {clusterLabel.get(node.cluster)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        <ul className="kg-kinds" aria-label="Filter by category">
          {KIND_ORDER.map((kind) => (
            <li key={kind}>
              <button
                type="button"
                className={`kg-kind ${hidden.has(kind) ? "off" : ""}`}
                aria-pressed={!hidden.has(kind)}
                onClick={() => toggleKind(kind)}
              >
                <ShapeIcon kind={kind} /> {KIND[kind].label}
                <small>{counts.get(kind) ?? 0}</small>
              </button>
            </li>
          ))}
        </ul>
        <p className="kg-edges">
          <span><i className="kg-line solid" /> Code edge</span>
          <span><i className="kg-line dashed" /> Conceptual</span>
        </p>
        <button type="button" className="ghost kg-reset" onClick={showAll}>
          Show whole graph
        </button>
      </aside>

      {selectedNode && (
        <KnowledgeDetail
          node={selectedNode}
          links={data.links.filter((link) => link.source === selectedNode.id || link.target === selectedNode.id)}
          byId={byId}
          codeNodes={codeNodes}
          clusterLabel={clusterLabel.get(selectedNode.cluster) ?? selectedNode.cluster}
          onSelect={select}
          onZoomCluster={() => zoomToCluster(selectedNode.cluster)}
          onOpenCode={onOpenCode}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
