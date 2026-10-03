import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods } from "react-force-graph-3d";
import { ask, fetchBlast, fetchGraph, fetchKnowledge, fetchNode, fetchSearch } from "./api";
import { AgentPanel } from "./AgentPanel";
import { Graph3D } from "./Graph3D";
import { Inspector } from "./Inspector";
import { KnowledgeView } from "./KnowledgeView";
import { flyTo, playTour } from "./tour";
import type { GNode, GraphData, KnowledgeData, NodeDetail, SearchHit } from "./types";

type View = "code" | "knowledge";

export default function App() {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const closeStream = useRef<(() => void) | null>(null);
  const tourGen = useRef(0);
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
  const [view, setView] = useState<View>("code");
  const [knowledge, setKnowledge] = useState<KnowledgeData | null>(null);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);

  const onReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    if (view !== "knowledge" || knowledge) return;
    let cancelled = false;
    fetchKnowledge()
      .then((data) => {
        if (!cancelled) setKnowledge(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) setKnowledgeError(error instanceof Error ? error.message : "Could not load the knowledge map");
      });
    return () => {
      cancelled = true;
    };
  }, [view, knowledge]);

  // The 3D graph stays mounted so its layout and tour survive a switch; only its render loop pauses.
  useEffect(() => {
    if (view === "code") fgRef.current?.resumeAnimation();
    else fgRef.current?.pauseAnimation();
  }, [view]);

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

  function showNode(node: NodeDetail) {
    setDetail(node);
    setCurrentId(node.id);
    setDrawerOpen(true);
  }

  async function openNode(id: string, fly: boolean) {
    const node = await fetchNode(id);
    showNode(node);
    if (fly) {
      const placed = nodesById[id];
      if (placed) await flyTo(fgRef.current, placed, 900);
    }
  }

  function onAsk(text: string) {
    const q = text.trim();
    if (!q || !ready || asking) return;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    tourGen.current += 1;
    const generation = tourGen.current;
    closeStream.current?.();
    setQuestion(q);
    setAsking(true);
    setStreamError(null);
    setLog([]);
    setCandidates(new Set());
    setBlast(null);
    let sawTour = false;
    closeStream.current = ask(q, (action) => {
      if (generation !== tourGen.current) return;
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
        void playTour(
          fgRef.current,
          nodesById,
          action.stops,
          (node) => {
            if (generation !== tourGen.current) return;
            showNode(node);
          },
          () => generation !== tourGen.current,
        ).finally(() => {
          if (generation === tourGen.current) setAsking(false);
        });
      }
      if (action.type === "done" && !sawTour) setAsking(false);
    });
  }

  async function onBlast(id: string) {
    const hitsForNode = await fetchBlast(id);
    setBlast(new Map(hitsForNode.map((hit) => [hit.id, hit.distance])));
    const framed = new Set(hitsForNode.map((hit) => hit.id));
    framed.add(id);
    fgRef.current?.zoomToFit(1200, 40, (node) => framed.has((node as GNode).id));
  }

  if (graphError) {
    return (
      <main className="blocker">
        <h1>RepoNav</h1>
        <p>The call graph did not load.</p>
        <p className="stream-error">{graphError}</p>
        <button type="button" onClick={() => { setGraphError(null); setReload((value) => value + 1); }}>
          Retry
        </button>
      </main>
    );
  }

  if (!graph) {
    return (
      <main className="blocker">
        <p className="kicker">Call path</p>
        <h1>RepoNav</h1>
        <p>Loading the call graph…</p>
      </main>
    );
  }

  function openInCode(id: string) {
    setView("code");
    void openNode(id, true);
  }

  return (
    <main className="app">
      <nav className="view-switch" aria-label="View">
        <button type="button" className={view === "code" ? "on" : ""} aria-pressed={view === "code"} onClick={() => setView("code")}>
          Code Graph
        </button>
        <button
          type="button"
          className={view === "knowledge" ? "on" : ""}
          aria-pressed={view === "knowledge"}
          onClick={() => {
            setKnowledgeError(null);
            setView("knowledge");
          }}
        >
          Knowledge Graph
        </button>
      </nav>
      <div className={view === "code" ? "stage" : "stage hidden"}>
        <Graph3D
          data={graph}
          path={path}
          pathLinks={pathLinks}
          current={currentId}
          candidates={candidates}
          blast={blast}
          blastOrigin={blast ? currentId : null}
          pulse={pulse}
          onClick={(node) => void openNode(node.id, false)}
          onReady={onReady}
          fgRef={fgRef}
        />
      </div>
      {view === "knowledge" &&
        (knowledge ? (
          <KnowledgeView data={knowledge} codeNodes={nodesById} onOpenCode={openInCode} />
        ) : (
          <div className="kg-status">
            <p className={knowledgeError ? "stream-error" : "empty"}>
              {knowledgeError ? `The knowledge map did not load: ${knowledgeError}` : "Loading the knowledge map…"}
            </p>
            {knowledgeError && (
              <button type="button" onClick={() => { setView("code"); }}>
                Back to code graph
              </button>
            )}
          </div>
        ))}
      {view === "code" && (
        <>
          <AgentPanel
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
          />
          <Inspector
            node={detail}
            open={drawerOpen}
            onToggle={() => setDrawerOpen((open) => !open)}
            onBlast={(id) => void onBlast(id)}
            blastActive={blast != null}
            onClearBlast={() => setBlast(null)}
          />
          <ul className="legend">
            {blast ? (
              <>
                <li><i className="swatch red" /> 1 hop</li>
                <li><i className="swatch orange" /> 2 hops</li>
                <li><i className="swatch gold" /> 3 hops or the change</li>
              </>
            ) : (
              <>
                <li><i className="swatch violet" /> Browser request</li>
                <li><i className="swatch cyan" /> Path</li>
                <li><i className="swatch gold" /> Current stop</li>
              </>
            )}
          </ul>
        </>
      )}
    </main>
  );
}
