import type { Action, BlastHit, GraphData, History, KnowledgeData, NodeDetail, SearchHit } from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8741";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export function fetchGraph(): Promise<GraphData> {
  return getJson("/graph");
}

export function fetchKnowledge(): Promise<KnowledgeData> {
  return getJson("/knowledge");
}

export function fetchHistory(): Promise<History> {
  return getJson("/history");
}

export function fetchNode(id: string): Promise<NodeDetail> {
  return getJson(`/node/${encodeURIComponent(id)}`);
}

export function fetchBlast(id: string): Promise<BlastHit[]> {
  return getJson(`/blast/${encodeURIComponent(id)}`);
}

export function fetchSearch(query: string): Promise<SearchHit[]> {
  return getJson(`/search?q=${encodeURIComponent(query)}`);
}

export function saveLayout(nodes: { id: string; x: number; y: number; z: number }[]): Promise<void> {
  return fetch(`${BASE}/layout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodes }),
  }).then(() => undefined);
}

export function ask(q: string, onAction: (action: Action) => void): () => void {
  const source = new EventSource(`${BASE}/ask?q=${encodeURIComponent(q)}`);
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    source.close();
  };
  source.onmessage = (event) => {
    const action = JSON.parse(event.data) as Action;
    onAction(action);
    if (action.type === "done") finish();
  };
  source.onerror = () => {
    if (closed) return;
    finish();
    onAction({
      type: "error",
      message: "The question stream closed before a tour arrived.",
    });
  };
  return finish;
}
