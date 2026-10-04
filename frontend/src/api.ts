import type { Action, ArchitectureInfo, BlastHit, GraphData, History, ModelConfig, NodeDetail, RegroupResult, RepoList, SearchHit, TourStop } from "./types";

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

export function fetchHistory(): Promise<History> {
  return getJson("/history");
}

export function fetchConfig(): Promise<ModelConfig> {
  return getJson("/config");
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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const data = (await response.json()) as { detail?: string };
      if (data.detail) detail = data.detail;
    } catch {
      // keep the status line
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export function narrateTour(
  question: string,
  stops: TourStop[],
): Promise<{ stops: TourStop[]; source: string; error: string | null }> {
  return postJson("/narrate", { question, stops });
}

export async function fetchSpeech(text: string, voice: string): Promise<Blob> {
  const response = await fetch(`${BASE}/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
  });
  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      detail = ((await response.json()) as { detail?: string }).detail ?? detail;
    } catch {
      // keep the status code
    }
    throw new Error(detail);
  }
  return response.blob();
}

export function regroup(
  prompt: string,
  current: { title: string; groups: { name: string; members: string[] }[] } | null,
): Promise<RegroupResult> {
  return postJson("/regroup", { prompt, current });
}

export function fetchArchitecture(): Promise<ArchitectureInfo> {
  return getJson("/architecture");
}

export function fetchRepos(): Promise<RepoList> {
  return getJson("/repos");
}

export function activateRepo(id: string): Promise<RepoList> {
  return postJson("/repos/activate", { id });
}

export function uploadRepo(name: string, files: { path: string; content: string }[]): Promise<RepoList> {
  return postJson("/repos/upload", { name, files });
}

export async function deleteRepo(id: string): Promise<RepoList> {
  const response = await fetch(`${BASE}/repos/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<RepoList>;
}
