export type NodeType = "file" | "class" | "function" | "method" | "external";
export type LinkType = "contains" | "imports" | "calls" | "depends";

export type GNode = {
  id: string;
  label: string;
  type: NodeType;
  file_path: string;
  line_start: number;
  line_end: number;
  module: string;
  cls: string | null;
  cluster: string;
  doc: string;
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
};

export type GLink = {
  source: string | GNode;
  target: string | GNode;
  type: LinkType;
  line: number | null;
  confidence: "exact" | "heuristic" | "manual";
};

export type GraphData = { nodes: GNode[]; links: GLink[] };

export type TourStop = {
  node_id: string;
  narration: string;
  evidence: string;
};

export type Action =
  | { type: "status"; message: string }
  | { type: "candidates"; node_ids: string[] }
  | { type: "tour"; stops: TourStop[] }
  | { type: "error"; message: string }
  | { type: "done" };

export type NodeDetail = GNode & {
  file_source: string;
  evidence?: string;
  narration?: string;
};

export type SearchHit = {
  id: string;
  type: string;
  file: string;
  score: number;
  calls: string[];
};

export type BlastHit = { id: string; distance: number };

export const PRESET_QUESTIONS = [
  "How does login work, and where does the request end up?",
  "How does an authenticated request load the current user?",
  "How is a new user created?",
] as const;
