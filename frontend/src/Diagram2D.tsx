import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EDGE_STYLE } from "./colors";
import { pastel, reachable, type Box, type BoxEdge, type Diagram } from "./diagram";
import type { LinkType } from "./types";

type Props = {
  diagram: Diagram;
  focusKeys: Set<string> | null;
  tourPath: string[];
  currentBox: string | null;
  currentLabel: string | null;
  blast: Map<string, number> | null;
  edgeTypes: Set<LinkType>;
  startFrom: string | null;
  fitSignal: number;
  insets: { left: number; right: number; top: number; bottom: number };
  onBoxClick: (box: Box) => void;
};

type View = { x: number; y: number; k: number };

// Room taken by the floating panels, so "fit" frames the diagram in the free
// middle of the screen rather than under the side panels.
const PATH_BLUE = "#36c5ff";
const GOLD = "#ffd400";
const BLAST = ["#ffd400", "#ff4d4d", "#ff8a3d", "#ffd400"];

function wrap(text: string, max = 11): string[] {
  const words = text.split(/[\s_]+/);
  const lines: string[] = [];
  let line = "";
  words.forEach((word) => {
    if (!line) line = word;
    else if ((line + " " + word).length <= max) line += " " + word;
    else {
      lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  if (lines.length > 3) return [...lines.slice(0, 2), lines.slice(2).join(" ").slice(0, max - 1) + "…"];
  return lines;
}

function pillWidth(text: string): number {
  return Math.round(text.length * 6.7 + 18);
}

export function Diagram2D({
  diagram,
  focusKeys,
  tourPath,
  currentBox,
  currentLabel,
  blast,
  edgeTypes,
  startFrom,
  fitSignal,
  insets,
  onBoxClick,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  // `manual` is null while the diagram is auto-fitted; any pan or zoom stores
  // an explicit view. A new fit request or a new diagram drops back to auto.
  const [manual, setManual] = useState<View | null>(null);
  // Frame whatever matters right now: a focused circle and its neighbours,
  // the tour's path, or the whole diagram.
  const frameKeys = useMemo(() => {
    if (tourPath.length) return new Set(tourPath);
    if (!focusKeys || focusKeys.size === 0) return null;
    const keys = new Set(focusKeys);
    diagram.edges.forEach((e) => {
      if (focusKeys.has(e.from)) keys.add(e.to);
      if (focusKeys.has(e.to)) keys.add(e.from);
    });
    return keys;
  }, [diagram, focusKeys, tourPath]);
  const frameId = frameKeys ? [...frameKeys].sort().join("|") : "";
  const [fitSeen, setFitSeen] = useState({ signal: fitSignal, diagram, frameId });
  if (fitSeen.signal !== fitSignal || fitSeen.diagram !== diagram || fitSeen.frameId !== frameId) {
    setFitSeen({ signal: fitSignal, diagram, frameId });
    setManual(null);
  }
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const uid = useId().replace(/:/g, "");

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitted = useMemo<View>(() => {
    const narrow = size.w < 1100;
    const pad = narrow ? { left: 16, right: 16, top: 120, bottom: 200 } : insets;
    const usableW = Math.max(260, size.w - pad.left - pad.right);
    const usableH = Math.max(220, size.h - pad.top - pad.bottom);
    let minX = diagram.minX;
    let minY = diagram.minY;
    let width = diagram.width;
    let height = diagram.height;
    if (frameKeys) {
      const boxes = diagram.boxes.filter((b) => frameKeys.has(b.key));
      if (boxes.length) {
        minX = Math.min(...boxes.map((b) => b.x - b.r)) - 50;
        minY = Math.min(...boxes.map((b) => b.y - b.r)) - 40;
        const maxX = Math.max(...boxes.map((b) => b.x + b.r)) + 50;
        const maxY = Math.max(...boxes.map((b) => b.y + b.r)) + 80;
        width = maxX - minX;
        height = maxY - minY;
      }
    }
    const k = Math.min(1.3, usableW / width, usableH / height);
    const x = pad.left + (usableW - width * k) / 2 - minX * k;
    const y = pad.top + (usableH - height * k) / 2 - minY * k;
    return { x, y, k };
  }, [diagram, frameKeys, insets, size]);
  const view = manual ?? fitted;
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  });

  // Wheel zoom around the cursor. React's onWheel is passive, so attach by hand.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setManual(() => {
        const v = viewRef.current;
        const k = Math.min(3, Math.max(0.3, v.k * Math.exp(-event.deltaY * 0.0015)));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const byKey = useMemo(() => new Map(diagram.boxes.map((b) => [b.key, b])), [diagram]);

  // What to light up: a tour path, a start-from flow, or nothing.
  const tourEdges = useMemo(() => {
    const keys = new Set<string>();
    for (let i = 1; i < tourPath.length; i += 1) keys.add(`${tourPath[i - 1]}=>${tourPath[i]}`);
    return keys;
  }, [tourPath]);
  const tourBoxes = useMemo(() => new Set(tourPath), [tourPath]);
  const flowHops = useMemo(() => (startFrom && tourPath.length === 0 ? reachable(diagram, startFrom) : null), [diagram, startFrom, tourPath]);

  const visibleEdges = diagram.edges.filter((e) => edgeTypes.has(e.kind) || tourEdges.has(e.key));

  const boxDim = (box: Box): boolean => {
    if (blast) return !blast.has(box.key);
    if (tourPath.length) return !tourBoxes.has(box.key);
    if (focusKeys) {
      if (focusKeys.has(box.key)) return false;
      return !diagram.edges.some(
        (e) => (focusKeys.has(e.from) && e.to === box.key) || (focusKeys.has(e.to) && e.from === box.key),
      );
    }
    if (flowHops) return !flowHops.has(box.key);
    return false;
  };

  const edgeState = (e: BoxEdge): "path" | "flow" | "focus" | "dim" | "normal" => {
    if (tourEdges.has(e.key)) return "path";
    if (blast || tourPath.length) return "dim";
    if (hover) return e.from === hover || e.to === hover ? "focus" : "dim";
    if (focusKeys) return focusKeys.has(e.from) || focusKeys.has(e.to) ? "focus" : "dim";
    if (flowHops) return flowHops.has(e.from) && flowHops.has(e.to) && (flowHops.get(e.to) ?? 0) > (flowHops.get(e.from) ?? 0) ? "flow" : "dim";
    return "normal";
  };

  const edgeColor = (e: BoxEdge, st: string) => (st === "path" ? PATH_BLUE : EDGE_STYLE[e.kind].color);

  return (
    <div
      ref={wrapRef}
      className="diagram"
      onPointerDown={(event) => {
        if ((event.target as Element).closest(".d-box, button")) return;
        drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, moved: false };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d) return;
        const dx = event.clientX - d.x;
        const dy = event.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        setManual({ ...viewRef.current, x: d.vx + dx, y: d.vy + dy });
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      <svg width={size.w} height={size.h} role="img" aria-label="Architecture diagram">
        <defs>
          <pattern id={`dots-${uid}`} width={24} height={24} patternUnits="userSpaceOnUse">
            <circle cx={1.5} cy={1.5} r={1.1} fill="rgba(255,255,255,0.07)" />
          </pattern>
          {(["calls", "depends"] as LinkType[]).map((kind) => (
            <marker key={kind} id={`arrow-${kind}-${uid}`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={EDGE_STYLE[kind].color} />
            </marker>
          ))}
          <marker id={`arrow-path-${uid}`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill={PATH_BLUE} />
          </marker>
          <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={6} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect width={size.w} height={size.h} fill={`url(#dots-${uid})`} />
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {visibleEdges.map((e, i) => {
            const st = edgeState(e);
            const color = edgeColor(e, st);
            const width = st === "path" ? 4 : Math.min(5, 1.4 + Math.sqrt(e.total) * 0.7);
            const marker = st === "path" ? `arrow-path-${uid}` : `arrow-${e.kind}-${uid}`;
            const id = `edge-${uid}-${i}`;
            const animated = st === "path" || st === "flow";
            const delay = st === "flow" && flowHops ? (flowHops.get(e.from) ?? 0) * 0.55 : 0;
            const parts = Object.entries(e.counts)
              .map(([kind, n]) => `${n} ${kind}`)
              .join(", ");
            return (
              <g key={e.key} className={`d-edge ${st}`}>
                <path
                  id={id}
                  d={e.path}
                  fill="none"
                  stroke={color}
                  strokeWidth={width}
                  strokeOpacity={st === "dim" ? 0.12 : st === "normal" ? 0.6 : 0.95}
                  markerEnd={`url(#${marker})`}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <title>{`${byKey.get(e.from)?.title} → ${byKey.get(e.to)?.title}: ${parts}`}</title>
                </path>
                {animated &&
                  [0, 1, 2].map((n) => (
                    <circle key={n} r={st === "path" ? 5 : 4} fill={st === "path" ? "#e6f8ff" : color} opacity={0}>
                      <animateMotion dur="1.6s" begin={`${delay + n * 0.53}s`} repeatCount="indefinite" rotate="auto">
                        <mpath href={`#${id}`} />
                      </animateMotion>
                      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="1.6s" begin={`${delay + n * 0.53}s`} repeatCount="indefinite" />
                    </circle>
                  ))}
              </g>
            );
          })}

          {diagram.boxes.map((box) => {
            const dim = boxDim(box);
            const isCurrent = box.key === currentBox;
            const focused = focusKeys?.has(box.key) ?? false;
            const blastHop = blast?.get(box.key);
            const ring = isCurrent ? GOLD : blastHop != null ? BLAST[Math.min(blastHop, 3)] : tourBoxes.has(box.key) ? PATH_BLUE : box.color;
            const lines = box.kind === "custom" ? wrap(box.title, 12) : [box.title];
            const titleSize = box.kind === "custom" ? 14 : lines[0].length > 11 ? 13.5 : 16.5;
            const pills = box.tech.slice(0, 2);
            const total = pills.reduce((sum, p) => sum + pillWidth(p) + 6, -6);
            let px = -total / 2;
            const count = box.kind === "entry" ? 0 : box.ids.size - (box.kind === "file" ? 1 : 0);
            return (
              <g
                key={box.key}
                className={`d-box${dim ? " dim" : ""}${isCurrent ? " current" : ""}`}
                transform={`translate(${box.x},${box.y})`}
                onClick={() => {
                  if (drag.current?.moved) return;
                  onBoxClick(box);
                }}
                onPointerEnter={() => setHover(box.key)}
                onPointerLeave={() => setHover((h) => (h === box.key ? null : h))}
                role="button"
                tabIndex={0}
                aria-label={`${box.title}, ${box.role}`}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onBoxClick(box);
                }}
              >
                {(isCurrent || focused) && <circle r={box.r + 9} fill="none" stroke={ring} strokeWidth={3} opacity={0.55} filter={`url(#glow-${uid})`} />}
                <circle r={box.r} fill={pastel(box.color, 0.58)} stroke={ring} strokeWidth={isCurrent || focused || tourBoxes.has(box.key) ? 4.5 : 3} />
                <text className="d-title" textAnchor="middle" y={-((lines.length - 1) * 16) / 2 - (box.kind === "custom" ? 3 : 4)} fontSize={titleSize}>
                  {lines.map((line, i) => (
                    <tspan key={i} x={0} dy={i === 0 ? 0 : 16}>
                      {line}
                    </tspan>
                  ))}
                </text>
                <text className="d-role" textAnchor="middle" y={(lines.length - 1) * 8 + 14} fontSize={11.5}>
                  {box.role}
                </text>
                {count > 0 && (
                  <g transform={`translate(${box.r * 0.72},${-box.r * 0.72})`}>
                    <circle r={13} fill="#0b0d14" stroke={box.color} strokeWidth={1.5} />
                    <text textAnchor="middle" y={4.5} fontSize={11.5} className="d-count">
                      {count}
                    </text>
                  </g>
                )}
                {pills.map((p) => {
                  const w = pillWidth(p);
                  const x = px;
                  px += w + 6;
                  return (
                    <g key={p} transform={`translate(${x},${box.r + 12})`} className={box.kind === "entry" ? "d-pill entry" : "d-pill"}>
                      <rect width={w} height={22} rx={11} />
                      <text x={w / 2} y={15.5} textAnchor="middle" fontSize={11.5}>
                        {p}
                      </text>
                    </g>
                  );
                })}
                {isCurrent && currentLabel && (
                  <g transform={`translate(0,${box.r + (pills.length ? 42 : 14)})`} className="d-stop">
                    <rect x={-pillWidth(currentLabel) / 2 - 6} width={pillWidth(currentLabel) + 12} height={26} rx={13} />
                    <text textAnchor="middle" y={17.5} fontSize={12.5}>
                      {currentLabel}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {diagram.boxes.length === 0 && (
        <div className="d-empty">
          <strong>No calls between files to draw</strong>
          <span>This code's files don't call into each other, so there is no request flow. Switch to 3D to see every file.</span>
        </div>
      )}
      <div className="d-hint">Click a circle to open it · drag to move · scroll to zoom</div>
    </div>
  );
}
