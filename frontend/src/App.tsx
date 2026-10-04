import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods } from "react-force-graph-3d";
import { ask, fetchArchitecture, fetchBlast, fetchConfig, fetchGraph, fetchHistory, fetchNode, fetchSearch, narrateTour, regroup } from "./api";
import { AgentPanel } from "./AgentPanel";
import { EDGE_ORDER, EDGE_STYLE, buildFileColors, colorForNode } from "./colors";
import { Diagram2D } from "./Diagram2D";
import { buildDiagram, type Box, type BoxSeed } from "./diagram";
import { Graph3D, type GraphGrouping } from "./Graph3D";
import { animateTo, fromResult, type CustomGroup, type Grouping, type Vec } from "./grouping";
import { GroupPanel, type Group, type Neighbour } from "./GroupPanel";
import { Inspector } from "./Inspector";
import { NavBar, type Crumb } from "./NavBar";
import { RegroupPanel } from "./RegroupPanel";
import { Timeline } from "./Timeline";
import { CodeView } from "./CodeView";
import { flyTo, frameNodes } from "./tour";
import { TourBar } from "./TourBar";
import type { ArchitectureInfo, GNode, GraphData, History, LinkType, ModelConfig, NodeDetail, RepoInfo, SearchHit, TourStop } from "./types";
import { useTour } from "./useTour";
import { stopAllSpeech, type VoiceChoice } from "./voice";

const NARRATE_TIMEOUT_MS = 20000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timed out")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function usePersisted(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    const saved = window.localStorage.getItem(key);
    return saved == null ? initial : saved === "1";
  });
  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      window.localStorage.setItem(key, next ? "1" : "0");
    },
    [key],
  );
  return [value, set];
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export default function App({ repo, repoPicker }: { repo: RepoInfo; repoPicker: ReactNode }) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const closeStream = useRef<(() => void) | null>(null);
  const askGen = useRef(0);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [ready, setReady] = useState(false);
  const [question, setQuestion] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [path, setPath] = useState<Set<string>>(new Set());
  const [pathLinks, setPathLinks] = useState<Set<string>>(new Set());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [candidates, setCandidates] = useState<Set<string>>(new Set());
  const [pulse, setPulse] = useState(false);
  const [blast, setBlast] = useState<Map<string, number> | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [edgeTypes, setEdgeTypes] = useState<Set<LinkType>>(new Set<LinkType>(["calls", "depends", "imports"]));
  const [history, setHistory] = useState<History | null>(null);
  const [timeIndex, setTimeIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null);
  const [focus, setFocus] = useState<Group | null>(null);
  const [nodeFocusId, setNodeFocusId] = useState<string | null>(null);
  const [tab, setTab] = useState<"tour" | "regroup">("tour");
  const [voice, setVoice] = useState("browser");
  const [groupings, setGroupings] = useState<Grouping[]>([]);
  const [activeGroupingId, setActiveGroupingId] = useState("original");
  const [regroupBusy, setRegroupBusy] = useState(false);
  const [regroupError, setRegroupError] = useState<string | null>(null);
  const [codeView, setCodeView] = useState(false);
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [arch, setArch] = useState<ArchitectureInfo | null>(null);
  const [startFrom, setStartFrom] = useState<string | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [panelCollapsed, setPanelCollapsed] = usePersisted("reponav.panelCollapsed", false);
  const [railCollapsed, setRailCollapsed] = usePersisted("reponav.railCollapsed", false);

  const grok = modelConfig?.grok;
  const grokVoice = Boolean(grok?.voice);

  useEffect(() => {
    fetchHistory().then(setHistory).catch(() => setHistory(null));
    fetchArchitecture().then(setArch).catch(() => setArch(null));
    fetchConfig()
      .then((config) => {
        setModelConfig(config);
        if (config.grok?.voice) setVoice(config.grok.default_voice);
      })
      .catch(() => setModelConfig(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchGraph()
      .then((data) => {
        if (!cancelled) setGraph(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) setGraphError(error instanceof Error ? error.message : "Could not load the graph");
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  // The layout the parser produced is grouping zero, so it can always be restored.
  const originalPositions = useMemo(() => {
    const map = new Map<string, Vec>();
    graph?.nodes.forEach((n) => map.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 }));
    return map;
  }, [graph]);

  useEffect(() => {
    if (!graph) return;
    setGroupings([
      {
        id: "original",
        title: "Folders and files (original)",
        prompt: "",
        summary: "",
        source: "parser",
        groups: [],
        hidden: new Set(),
        positions: originalPositions,
      },
    ]);
    setActiveGroupingId("original");
  }, [graph, originalPositions]);

  const fileColors = useMemo(() => buildFileColors(graph?.nodes ?? []), [graph]);
  const bornAt = useMemo(() => (history ? new Map(Object.entries(history.born_at)) : null), [history]);
  const activeGrouping = groupings.find((g) => g.id === activeGroupingId) ?? null;
  const custom = activeGrouping && activeGrouping.groups.length > 0 ? activeGrouping : null;

  const graphGrouping = useMemo<GraphGrouping | null>(
    () => (custom ? { groups: custom.groups, hidden: custom.hidden } : null),
    [custom],
  );

  function toggleEdge(kind: LinkType) {
    setEdgeTypes((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  const onReady = useCallback(() => setReady(true), []);
  const framedOnce = useRef(false);

  useEffect(() => {
    if (candidates.size === 0) return;
    const timer = window.setInterval(() => setPulse((value) => !value), 420);
    return () => window.clearInterval(timer);
  }, [candidates]);

  useEffect(() => {
    const query = search.trim();
    if (!query) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchSearch(query)
        .then((rows) => {
          if (!cancelled) setHits(rows);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  const nodesById = useMemo(() => {
    const map: Record<string, GNode> = {};
    graph?.nodes.forEach((node) => {
      map[node.id] = node;
    });
    return map;
  }, [graph]);

  // ------------------------------------------------------------ groups

  const { fileGroups, folderGroups } = useMemo(() => {
    const files = new Map<string, Group>();
    const folders = new Map<string, Group>();
    graph?.nodes.forEach((n) => {
      if (n.type === "external" || !n.file_path) return;
      const file = files.get(n.file_path) ?? {
        kind: "file" as const,
        key: n.file_path,
        title: n.file_path.split("/").pop() ?? n.file_path,
        subtitle: n.file_path,
        ids: new Set<string>(),
      };
      file.ids.add(n.id);
      files.set(n.file_path, file);
      const folder = folders.get(n.cluster) ?? {
        kind: "folder" as const,
        key: n.cluster,
        title: `${n.cluster.replace(/\./g, "/")}/`,
        subtitle: "",
        ids: new Set<string>(),
      };
      folder.ids.add(n.id);
      folders.set(n.cluster, folder);
    });
    folders.forEach((folder) => {
      const count = new Set([...folder.ids].map((id) => nodesById[id]?.file_path)).size;
      folder.subtitle = `${count} file${count === 1 ? "" : "s"}`;
    });
    return { fileGroups: files, folderGroups: folders };
  }, [graph, nodesById]);

  const { customGroups, customOf, customColor } = useMemo(() => {
    const groups = new Map<string, Group>();
    const of = new Map<string, Group>();
    const colors = new Map<string, string>();
    custom?.groups.forEach((g) => {
      const group: Group = { kind: "custom", key: g.key, title: g.name, subtitle: g.why, ids: new Set(g.members) };
      groups.set(g.key, group);
      colors.set(g.key, g.color);
      g.members.forEach((id) => of.set(id, group));
    });
    return { customGroups: groups, customOf: of, customColor: colors };
  }, [custom]);

  const colorOfNode = useCallback(
    (node: GNode) => {
      if (custom) {
        const group = customOf.get(node.id);
        return (group && customColor.get(group.key)) ?? "#6b7080";
      }
      return colorForNode(node, fileColors);
    },
    [custom, customColor, customOf, fileColors],
  );

  const groupOf = useCallback(
    (node: GNode, kind: Group["kind"]) => {
      if (kind === "file") return fileGroups.get(node.file_path);
      if (kind === "folder") return folderGroups.get(node.cluster);
      return customOf.get(node.id);
    },
    [customOf, fileGroups, folderGroups],
  );

  const groupColor = useCallback(
    (group: Group) => {
      if (group.kind === "custom") return customColor.get(group.key) ?? "#36c5ff";
      const first = [...group.ids].map((id) => nodesById[id]).find(Boolean);
      return first ? colorForNode(first, fileColors) : "#36c5ff";
    },
    [customColor, fileColors, nodesById],
  );

  // One level up from a file: its custom group when a custom grouping is on
  // (the group holding most of the file), otherwise its folder.
  const parentOf = useCallback(
    (group: Group): Group | null => {
      if (group.kind !== "file") return null;
      const fileNode = [...group.ids].map((id) => nodesById[id]).find((n) => n?.type === "file");
      if (custom) {
        const tally = new Map<Group, number>();
        group.ids.forEach((id) => {
          const g = customOf.get(id);
          if (g) tally.set(g, (tally.get(g) ?? 0) + 1);
        });
        const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
        return best ? best[0] : null;
      }
      return fileNode ? folderGroups.get(fileNode.cluster) ?? null : null;
    },
    [custom, customOf, folderGroups, nodesById],
  );

  const neighbours = useMemo<Neighbour[]>(() => {
    if (!focus || !graph) return [];
    const tally = new Map<string, Neighbour>();
    graph.links.forEach((link) => {
      if (link.type === "contains") return;
      const a = typeof link.source === "string" ? link.source : link.source.id;
      const b = typeof link.target === "string" ? link.target : link.target.id;
      const inA = focus.ids.has(a);
      const inB = focus.ids.has(b);
      if (inA === inB) return;
      const other = nodesById[inA ? b : a];
      if (!other || other.type === "external") return;
      const group = groupOf(other, focus.kind);
      if (!group || group.key === focus.key) return;
      const entry = tally.get(group.key) ?? { group, calls: 0, color: groupColor(group) };
      entry.calls += 1;
      tally.set(group.key, entry);
    });
    return [...tally.values()].sort((x, y) => y.calls - x.calls);
  }, [focus, graph, groupColor, groupOf, nodesById]);

  // ------------------------------------------------------------ camera

  const visibleNodes = useCallback(
    () => (graph?.nodes ?? []).filter((n) => !custom || !custom.hidden.has(n.id)),
    [custom, graph],
  );

  const frameAll = useCallback(
    (ms = 1100) => frameNodes(fgRef.current, visibleNodes(), ms, 1.05),
    [visibleNodes],
  );

  useEffect(() => {
    if (!ready || !graph || framedOnce.current) return;
    framedOnce.current = true;
    const timer = window.setTimeout(() => frameNodes(fgRef.current, graph.nodes, 0, 1.05), 50);
    return () => window.clearTimeout(timer);
  }, [graph, ready]);

  function showNode(node: NodeDetail) {
    setDetail(node);
    setCurrentId(node.id);
    setDrawerOpen(true);
  }

  // ------------------------------------------------------------ tour

  const voiceChoice: VoiceChoice = grokVoice && voice !== "browser" ? { kind: "grok", voice } : { kind: "browser" };

  const tourCtl = useTour({
    onStop: (node) => {
      showNode(node);
      setNodeFocusId(node.id);
    },
    fly: (id) => {
      const placed = nodesById[id];
      if (placed) void flyTo(fgRef.current, placed, 1400);
    },
    voice: voiceChoice,
  });

  function clearTourVisuals() {
    setPath(new Set());
    setPathLinks(new Set());
    setCandidates(new Set());
  }

  function exitTour() {
    askGen.current += 1;
    closeStream.current?.();
    setAsking(false);
    tourCtl.exit();
    stopAllSpeech();
    clearTourVisuals();
    setNodeFocusId(null);
    frameAll();
  }

  function onAsk(text: string) {
    const q = text.trim();
    if (!q || !ready || asking) return;
    tourCtl.exit();
    stopAllSpeech();
    askGen.current += 1;
    const generation = askGen.current;
    closeStream.current?.();
    setQuestion(q);
    setAsking(true);
    setStreamError(null);
    setLog([]);
    setCandidates(new Set());
    setBlast(null);
    setFocus(null);
    setTab("tour");
    let sawTour = false;
    closeStream.current = ask(q, (action) => {
      if (generation !== askGen.current) return;
      if (action.type === "status") setLog((lines) => [...lines, action.message]);
      if (action.type === "candidates") setCandidates(new Set(action.node_ids));
      if (action.type === "error") {
        if (sawTour) return;
        setStreamError(action.message);
        setAsking(false);
      }
      if (action.type === "tour") {
        sawTour = true;
        setCandidates(new Set());
        const ids = action.stops.map((stop) => stop.node_id);
        setPath(new Set(ids));
        const links = new Set<string>();
        for (let i = 1; i < ids.length; i += 1) links.add(`${ids[i - 1]}->${ids[i]}`);
        setPathLinks(links);
        setDrawerOpen(true);
        void beginTour(q, action.stops, generation);
      }
      if (action.type === "done" && !sawTour) setAsking(false);
    });
  }

  async function beginTour(q: string, stops: TourStop[], generation: number) {
    let finalStops = stops;
    let narratedBy = "original";
    if (grok?.chat) {
      setLog((lines) => [...lines, `${grok.model} is writing the tour narration…`]);
      try {
        const result = await withTimeout(narrateTour(q, stops), NARRATE_TIMEOUT_MS);
        finalStops = result.stops;
        narratedBy = result.source;
        if (result.error) setLog((lines) => [...lines, `Kept saved narration: ${result.error}`]);
        else setLog((lines) => [...lines, "Narration ready"]);
      } catch (error) {
        setLog((lines) => [...lines, `Kept saved narration: ${error instanceof Error ? error.message : "Grok failed"}`]);
      }
    }
    if (generation !== askGen.current) return;
    setAsking(false);
    tourCtl.start({ question: q, stops: finalStops, narratedBy });
  }

  // ------------------------------------------------------------ navigation

  function focusGroup(group: Group) {
    if (tourCtl.tour) {
      tourCtl.exit();
      stopAllSpeech();
      clearTourVisuals();
    }
    setBlast(null);
    setNodeFocusId(null);
    setFocus(group);
    // Side panels cover part of the screen, so give single files extra room.
    frameNodes(fgRef.current, [...group.ids].map((id) => nodesById[id]).filter(Boolean), 1100, 1.35);
  }

  // Move the camera toward (factor < 1) or away from (factor > 1) what it is looking at.
  function zoom(factor: number) {
    const fg = fgRef.current;
    if (!fg) return;
    const cam = fg.camera().position;
    const target = (fg.controls() as { target?: Vec } | undefined)?.target ?? { x: 0, y: 0, z: 0 };
    fg.cameraPosition(
      { x: target.x + (cam.x - target.x) * factor, y: target.y + (cam.y - target.y) * factor, z: target.z + (cam.z - target.z) * factor },
      { x: target.x, y: target.y, z: target.z },
      300,
    );
  }

  function goHome() {
    setCodeView(false);
    if (tourCtl.tour) {
      askGen.current += 1;
      tourCtl.exit();
      stopAllSpeech();
    }
    clearTourVisuals();
    setBlast(null);
    setNodeFocusId(null);
    setFocus(null);
    frameAll();
  }

  function fileGroupOfId(id: string): Group | undefined {
    const node = nodesById[id];
    return node && node.file_path ? fileGroups.get(node.file_path) : undefined;
  }

  // Up walks out one level: code view -> function -> file -> folder (or custom group) -> everything.
  function goUp() {
    if (codeView) {
      setCodeView(false);
      return;
    }
    if (tourCtl.tour) {
      const id = nodeFocusId;
      askGen.current += 1;
      tourCtl.exit();
      stopAllSpeech();
      clearTourVisuals();
      const file = id ? fileGroupOfId(id) : undefined;
      if (file) focusGroup(file);
      else goHome();
      return;
    }
    if (blast) setBlast(null);
    if (nodeFocusId) {
      const file = fileGroupOfId(nodeFocusId);
      setNodeFocusId(null);
      if (file) focusGroup(file);
      else goHome();
      return;
    }
    if (focus) {
      const parent = parentOf(focus);
      if (parent) focusGroup(parent);
      else goHome();
      return;
    }
    frameAll();
  }

  // ------------------------------------------------------------ 2D diagram

  const diagram = useMemo(() => {
    if (!graph) return null;
    const seeds: BoxSeed[] = [];
    graph.nodes
      .filter((n) => n.type === "external")
      .forEach((n) =>
        seeds.push({ key: `entry:${n.id}`, kind: "entry", title: "Browser", role: "Entry point", tech: [n.label], color: "#c084fc", ids: new Set([n.id]) }),
      );
    if (custom) {
      custom.groups.forEach((g) => {
        const ids = new Set(g.members.filter((id) => nodesById[id]?.type !== "external"));
        if (ids.size) seeds.push({ key: g.key, kind: "custom", title: g.name, role: "Group", tech: [], color: g.color, ids });
      });
    } else {
      fileGroups.forEach((group) => {
        const info = arch?.files[group.key];
        seeds.push({
          key: group.key,
          kind: "file",
          title: group.title.replace(/\.py$/, "").replace(/^__init__$/, `${group.key.split("/").slice(-2, -1)[0] ?? ""}/`),
          role: info?.role ?? "Module",
          tech: info?.tech ?? [],
          color: groupColor(group),
          ids: group.ids,
        });
      });
    }
    return buildDiagram(seeds, graph.links, custom?.hidden ?? new Set());
  }, [arch, custom, fileGroups, graph, groupColor, nodesById]);

  const entryBoxes = useMemo(() => diagram?.boxes.filter((b) => b.kind === "entry") ?? [], [diagram]);

  const boxKeysFor = useCallback(
    (ids: Iterable<string>) => {
      const keys = new Set<string>();
      if (!diagram) return keys;
      for (const id of ids) {
        const key = diagram.boxOf.get(id);
        if (key) keys.add(key);
      }
      return keys;
    },
    [diagram],
  );

  const diagramFocus = useMemo(() => {
    if (nodeFocusId) return boxKeysFor([nodeFocusId]);
    if (focus) return boxKeysFor(focus.ids);
    return null;
  }, [boxKeysFor, focus, nodeFocusId]);

  const diagramTour = useMemo(() => {
    if (!diagram || !tourCtl.tour) return [] as string[];
    const keys: string[] = [];
    tourCtl.tour.stops.forEach((stop) => {
      const key = diagram.boxOf.get(stop.node_id);
      if (key && keys[keys.length - 1] !== key) keys.push(key);
    });
    return keys;
  }, [diagram, tourCtl.tour]);

  const diagramBlast = useMemo(() => {
    if (!blast || !diagram) return null;
    const hops = new Map<string, number>();
    if (currentId) {
      const origin = diagram.boxOf.get(currentId);
      if (origin) hops.set(origin, 0);
    }
    blast.forEach((distance, id) => {
      const key = diagram.boxOf.get(id);
      if (key && (hops.get(key) ?? 99) > distance) hops.set(key, distance);
    });
    return hops;
  }, [blast, currentId, diagram]);

  function switchView(next: "3d" | "2d") {
    setView(next);
    if (next === "2d") setFitSignal((n) => n + 1);
  }

  function onBoxClick(box: Box) {
    if (box.kind === "entry") {
      const id = [...box.ids][0];
      setStartFrom((current) => (current === box.key ? null : box.key));
      if (id) void openNode(id, false);
      return;
    }
    if (box.kind === "custom") {
      const group = customGroups.get(box.key);
      if (group) focusGroup(group);
      return;
    }
    const group = fileGroups.get(box.key);
    if (group) focusGroup(group);
    const fileNode = [...box.ids].map((id) => nodesById[id]).find((n) => n?.type === "file");
    if (fileNode) void openNode(fileNode.id, false);
  }

  const canGoUp = Boolean(codeView || tourCtl.tour || nodeFocusId || focus || blast);

  const crumbs = useMemo<Crumb[]>(() => {
    const trail: Crumb[] = [{ key: "all", label: custom ? custom.title : "All code", go: () => goHome() }];
    let level: Group | null = focus;
    if (nodeFocusId) {
      const file = fileGroupOfId(nodeFocusId);
      level = file ?? null;
    }
    if (level) {
      const parent = level.kind === "file" ? parentOf(level) : null;
      if (parent) trail.push({ key: `p:${parent.key}`, label: parent.title, color: groupColor(parent), go: () => focusGroup(parent) });
      const here = level;
      trail.push({ key: `g:${here.key}`, label: here.title, color: groupColor(here), go: () => focusGroup(here) });
    }
    if (nodeFocusId) {
      const node = nodesById[nodeFocusId];
      trail.push({ key: `n:${nodeFocusId}`, label: node ? node.label : nodeFocusId, go: () => undefined });
    }
    return trail;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custom, focus, nodeFocusId, nodesById, groupColor, parentOf]);

  // Keyboard: arrows and space drive a tour; Esc goes up a level.
  const keys = useRef({ next: () => {}, back: () => {}, toggle: () => {}, exit: () => {}, up: () => {}, touring: false });
  useLayoutEffect(() => {
    keys.current = {
      next: tourCtl.next,
      back: tourCtl.back,
      toggle: tourCtl.toggle,
      exit: exitTour,
      up: goUp,
      touring: Boolean(tourCtl.tour),
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const k = keys.current;
      if (k.touring) {
        if (event.key === "ArrowRight") k.next();
        else if (event.key === "ArrowLeft") k.back();
        else if (event.key === " ") k.toggle();
        else if (event.key === "Escape") k.exit();
        else return;
        event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        k.up();
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onNodeClick(node: GNode) {
    if (node.type === "file") {
      const group = fileGroups.get(node.file_path);
      if (group) focusGroup(group);
    }
    void openNode(node.id, false);
  }

  async function openNode(id: string, fly: boolean) {
    const node = await fetchNode(id);
    showNode(node);
    if (nodesById[id]?.type !== "file") setNodeFocusId(id);
    if (fly) {
      const placed = nodesById[id];
      if (placed) await flyTo(fgRef.current, placed, 900);
    }
  }

  async function onBlast(id: string) {
    const hitsForNode = await fetchBlast(id);
    setBlast(new Map(hitsForNode.map((hit) => [hit.id, hit.distance])));
    const framed = new Set(hitsForNode.map((hit) => hit.id));
    framed.add(id);
    frameNodes(fgRef.current, [...framed].map((nid) => nodesById[nid]).filter(Boolean), 1200, 1.2);
  }

  // ------------------------------------------------------------ regroup

  function applyGrouping(next: Grouping) {
    setActiveGroupingId(next.id);
    setDrawerOpen(false);
    setFocus(null);
    setNodeFocusId(null);
    setBlast(null);
    if (!graph) return;
    void animateTo(fgRef.current, graph.nodes, next.positions, 1200);
    const shown = graph.nodes.filter((n) => !next.hidden.has(n.id)).map((n) => next.positions.get(n.id) ?? n);
    frameNodes(fgRef.current, shown, 1200, 1.05);
  }

  async function onRegroup(prompt: string) {
    if (!graph) return;
    setRegroupBusy(true);
    setRegroupError(null);
    const current = custom ? { title: custom.title, groups: custom.groups.map((g) => ({ name: g.name, members: g.members })) } : null;
    try {
      const result = await regroup(prompt, current);
      const next = fromResult(`g${Date.now()}`, prompt, result, nodesById, originalPositions);
      setGroupings((list) => [...list, next]);
      applyGrouping(next);
    } catch (error) {
      setRegroupError(error instanceof Error ? error.message : "Regrouping failed");
    } finally {
      setRegroupBusy(false);
    }
  }

  function focusCustom(group: CustomGroup) {
    const found = customGroups.get(group.key);
    if (found) focusGroup(found);
  }

  // ------------------------------------------------------------ render

  if (graphError) {
    return (
      <main className="blocker">
        <h1>Navinator</h1>
        <p>The call graph did not load.</p>
        <p className="stream-error">{graphError}</p>
        <button
          type="button"
          onClick={() => {
            setGraphError(null);
            setReload((value) => value + 1);
          }}
        >
          Retry
        </button>
      </main>
    );
  }

  if (!graph) {
    return (
      <main className="blocker">
        <p className="kicker">Call path</p>
        <h1>Navinator</h1>
        <p>Loading the call graph…</p>
      </main>
    );
  }

  const aiName = grok?.chat ? "Grok" : modelConfig?.live ? modelConfig.model : null;

  return (
    <main className="app">
      <div className={view === "3d" ? "view3d" : "view3d hidden"}>
      <Graph3D
        data={graph}
        path={path}
        pathLinks={pathLinks}
        current={currentId}
        candidates={candidates}
        blast={blast}
        blastOrigin={blast ? currentId : null}
        pulse={pulse}
        fileColors={fileColors}
        edgeTypes={edgeTypes}
        bornAt={bornAt}
        timeIndex={timeIndex}
        focus={focus?.ids ?? null}
        grouping={graphGrouping}
        onClick={onNodeClick}
        onReady={onReady}
        fgRef={fgRef}
      />
      </div>
      {view === "2d" && !codeView && diagram && (
        <Diagram2D
          diagram={diagram}
          focusKeys={diagramFocus}
          tourPath={diagramTour}
          currentBox={tourCtl.tour && currentId ? diagram.boxOf.get(currentId) ?? null : null}
          currentLabel={tourCtl.tour && currentId ? nodesById[currentId]?.label ?? null : null}
          blast={diagramBlast}
          edgeTypes={edgeTypes}
          startFrom={startFrom}
          fitSignal={fitSignal}
          insets={{
            left: railCollapsed ? 40 : 330,
            right: panelCollapsed ? 200 : 430,
            top: tourCtl.tour ? 210 : 124,
            bottom: drawerOpen && detail ? Math.round(window.innerHeight * 0.32) + 130 : 100,
          }}
          onBoxClick={onBoxClick}
        />
      )}
      <div className="topcenter">
        <NavBar crumbs={crumbs} onUp={goUp} onHome={goHome} canGoUp={canGoUp} codeView={codeView} onCodeView={() => setCodeView(!codeView)} view={view} onView={switchView} />
        {view === "2d" && !codeView && !tourCtl.tour && entryBoxes.length > 0 && (
          <div className="startbar">
            <span>Start from</span>
            {entryBoxes.map((box) => (
              <button
                key={box.key}
                type="button"
                className={startFrom === box.key ? "chip on active" : "chip on"}
                onClick={() => setStartFrom((current) => (current === box.key ? null : box.key))}
              >
                <i style={{ background: box.color }} />
                {box.tech[0]}
              </button>
            ))}
            {startFrom && (
              <button type="button" className="chip" onClick={() => setStartFrom(null)}>
                Show everything
              </button>
            )}
            <button type="button" className="chip" onClick={() => setFitSignal((n) => n + 1)} title="Fit the diagram to the screen">
              ⤢ Fit
            </button>
          </div>
        )}
        {tourCtl.tour && (
          <TourBar
            stops={tourCtl.tour.stops}
            index={tourCtl.index}
            playing={tourCtl.playing}
            finished={tourCtl.finished}
            narratedBy={tourCtl.tour.narratedBy}
            voice={voiceChoice.kind === "grok" ? voice : "browser"}
            voices={grok?.voices ?? []}
            grokVoice={grokVoice}
            voiceStatus={tourCtl.voiceStatus}
            onVoice={(v) => {
              setVoice(v);
              window.setTimeout(() => tourCtl.goTo(tourCtl.index), 0);
            }}
            onBack={tourCtl.back}
            onToggle={tourCtl.toggle}
            onNext={tourCtl.next}
            onExit={exitTour}
            onJump={tourCtl.goTo}
          />
        )}
      </div>
      {codeView && <CodeView nodes={graph.nodes} selected={detail} colorOf={(path) => fileColors.get(path)} />}
      {!codeView && view === "3d" && (
        <div className="zoom" role="group" aria-label="Zoom">
          <button type="button" className="ghost" title="Zoom in" aria-label="Zoom in" onClick={() => zoom(0.7)}>
            +
          </button>
          <button type="button" className="ghost" title="Zoom out" aria-label="Zoom out" onClick={() => zoom(1.4)}>
            −
          </button>
        </div>
      )}
      {!codeView && (
        <>
          <AgentPanel
            collapsed={panelCollapsed}
            onCollapse={setPanelCollapsed}
            repoPicker={repoPicker}
            demo={repo.kind === "demo"}
            askHint={
              repo.kind !== "demo" && modelConfig && !modelConfig.live
                ? "Asking needs ANTHROPIC_API_KEY or private mode for this repo. Search, regroup, and the graph work without one."
                : null
            }
            question={question}
            onQuestion={setQuestion}
            onAsk={onAsk}
            asking={asking}
            ready={ready}
            log={log}
            error={streamError}
            search={search}
            onSearch={setSearch}
            hits={search.trim() ? hits : []}
            onJump={(id) => void openNode(id, true)}
            tab={tab}
            onTab={setTab}
            regroup={
              <RegroupPanel
                groupings={groupings}
                activeId={activeGroupingId}
                busy={regroupBusy}
                error={regroupError}
                aiName={aiName}
                onAsk={(prompt) => void onRegroup(prompt)}
                onSwitch={(id) => {
                  const next = groupings.find((g) => g.id === id);
                  if (next) applyGrouping(next);
                }}
                onFocus={focusCustom}
              />
            }
          />
          <Inspector
            node={detail}
            open={drawerOpen}
            onToggle={() => setDrawerOpen((open) => !open)}
            onBlast={(id) => void onBlast(id)}
            blastActive={blast != null}
            onClearBlast={() => setBlast(null)}
            onOpenGroup={(id) => {
              const group = fileGroupOfId(id);
              if (group) focusGroup(group);
            }}
          />
          <div className={railCollapsed ? "rail collapsed" : "rail"}>
            <button
              type="button"
              className="ghost collapse-btn"
              aria-expanded={!railCollapsed}
              onClick={() => setRailCollapsed(!railCollapsed)}
            >
              {railCollapsed ? "Show legend and folders ▸" : "◂ Hide"}
            </button>
            {!railCollapsed && (
              <>
                {focus && (
                  <GroupPanel
                    group={focus}
                    members={[...focus.ids].map((id) => nodesById[id]).filter(Boolean)}
                    neighbours={neighbours}
                    color={groupColor(focus)}
                    colorOf={colorOfNode}
                    onMember={(id) => void openNode(id, true)}
                    onGroup={focusGroup}
                    onExit={goUp}
                  />
                )}
                <ul className="legend">
                  {view === "2d" && !blast ? (
                    <>
                      <li><i className="swatch ring" /> {custom ? "Circle = one of your groups" : "Circle = one file"}</li>
                      {entryBoxes.length > 0 && <li><i className="swatch violet" /> Browser request (start)</li>}
                      <li><i className="swatch line" /> Arrows = how data travels</li>
                      <li><i className="swatch cyan" /> Tour path</li>
                    </>
                  ) : blast ? (
                    <>
                      <li><i className="swatch red" /> 1 hop</li>
                      <li><i className="swatch orange" /> 2 hops</li>
                      <li><i className="swatch gold" /> 3 hops or the change</li>
                    </>
                  ) : timeIndex != null ? (
                    <>
                      <li><i className="swatch green" /> Added in this commit</li>
                      <li><i className="swatch ring" /> File (colour = file)</li>
                    </>
                  ) : custom ? (
                    <>
                      <li><i className="swatch ring" /> Colour = your custom group</li>
                      <li><i className="swatch cyan" /> Path</li>
                      <li><i className="swatch gold" /> Current stop</li>
                    </>
                  ) : (
                    <>
                      <li><i className="swatch ring" /> File, each its own colour</li>
                      {graph.nodes.some((n) => n.type === "external") && <li><i className="swatch violet" /> Browser request</li>}
                      <li><i className="swatch cyan" /> Path</li>
                      <li><i className="swatch gold" /> Current stop</li>
                    </>
                  )}
                </ul>
                <section className="edges" aria-label="Connection types">
                  <strong>Connections</strong>
                  {EDGE_ORDER.filter((kind) => view === "3d" || kind === "calls" || kind === "depends").map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={edgeTypes.has(kind) ? "chip on" : "chip"}
                      aria-pressed={edgeTypes.has(kind)}
                      title={EDGE_STYLE[kind].hint}
                      onClick={() => toggleEdge(kind)}
                    >
                      <i style={{ background: EDGE_STYLE[kind].color }} />
                      {EDGE_STYLE[kind].label}
                    </button>
                  ))}
                </section>
                {modelConfig && (
                  <p className={modelConfig.on_device ? "model private" : "model"}>
                    <i />
                    {modelConfig.on_device
                      ? `Private mode · ${modelConfig.model} on this machine`
                      : modelConfig.live
                        ? `Cloud model · ${modelConfig.model}`
                        : "Demo mode · saved tours"}
                    {grok?.chat ? " · Grok on" : ""}
                  </p>
                )}
                {!focus && (
                  <section className="edges" aria-label={custom ? "Groups" : "Folders"}>
                    <strong>{custom ? "Click into a group" : "Click into a folder"}</strong>
                    {(custom ? [...customGroups.values()] : [...folderGroups.values()].sort((a, b) => a.key.localeCompare(b.key))).map((group) => (
                      <button key={group.key} type="button" className="chip on" onClick={() => focusGroup(group)}>
                        <i style={{ background: groupColor(group) }} />
                        {group.title}
                      </button>
                    ))}
                    <span className="tip">{view === "2d" ? "Or click any circle to open it." : "Or click any labelled file node to open its group."}</span>
                  </section>
                )}
                {view === "2d" && diagram && !focus && diagram.offPath.some((b) => b.ids.size > 1) && (
                  <section className="edges" aria-label="Files not on a request path">
                    <strong>Not on a request path</strong>
                    {diagram.offPath
                      .filter((b) => b.ids.size > 1)
                      .map((b) => (
                        <button key={b.key} type="button" className="chip on" onClick={() => onBoxClick(b)} title={b.key}>
                          <i style={{ background: b.color }} />
                          {b.key.replace(/^app\//, "")}
                        </button>
                      ))}
                    <span className="tip">Nothing in a request calls into these files directly.</span>
                  </section>
                )}
                {history && !focus && !custom && view === "3d" && (
                  <Timeline history={history} index={timeIndex} onIndex={setTimeIndex} playing={playing} onPlaying={setPlaying} />
                )}
              </>
            )}
          </div>
        </>
      )}
    </main>
  );
}
