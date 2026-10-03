import type { KnowledgeKind, KnowledgeRelation } from "./types";

// Three hues pass the all-pairs CVD check on #05060a; five do not, so topic and
// function use neutral ink and every kind also has its own shape.
export const KIND: Record<KnowledgeKind, { label: string; color: string; size: number }> = {
  topic: { label: "Topic", color: "#9aa0b4", size: 9 },
  architecture: { label: "Architecture", color: "#3987e5", size: 6.5 },
  concept: { label: "Concept", color: "#199e70", size: 4.8 },
  decision: { label: "Decision", color: "#d95926", size: 5.4 },
  function: { label: "Function", color: "#e7e8ee", size: 3.4 },
};

export const KIND_ORDER: KnowledgeKind[] = ["topic", "architecture", "concept", "decision", "function"];

// [outgoing, incoming] wording, read from the selected node.
export const RELATION: Record<KnowledgeRelation, [string, string]> = {
  calls_into: ["Calls into", "Called by"],
  depends_on: ["Depends on", "Depended on by"],
  part_of: ["Part of", "Contains"],
  implements: ["Implements", "Implemented by"],
  explains: ["Explains", "Explained by"],
  related_to: ["Related to", "Related to"],
};

export const INK = { primary: "#ffffff", secondary: "#c9ccd8", muted: "#8e93a6" };

export function drawMark(
  ctx: CanvasRenderingContext2D,
  kind: KnowledgeKind,
  x: number,
  y: number,
  selected: boolean,
) {
  const { color, size: r } = KIND[kind];
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (selected) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
  }
  ctx.beginPath();
  if (kind === "decision") {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fill();
  } else if (kind === "function") {
    ctx.rect(x - r, y - r, r * 2, r * 2);
    ctx.fill();
  } else if (kind === "topic") {
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = "#05060a";
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.stroke();
  } else {
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
    if (kind === "architecture") {
      const alpha = ctx.globalAlpha;
      ctx.globalAlpha = alpha * 0.45;
      ctx.beginPath();
      ctx.arc(x, y, r + 2.4, 0, 2 * Math.PI);
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }
  }
  ctx.shadowBlur = 0;
  if (selected) {
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, 2 * Math.PI);
    ctx.strokeStyle = INK.primary;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}
