import type { GNode, LinkType } from "./types";

export const EXTERNAL_COLOR = "#c084fc";

// Golden-angle hue steps keep neighbouring files far apart on the colour wheel,
// so two files in the same folder never end up as near-identical shades.
export function buildFileColors(nodes: GNode[]): Map<string, string> {
  const files = [...new Set(nodes.filter((n) => n.type !== "external").map((n) => n.file_path))].sort();
  const colors = new Map<string, string>();
  files.forEach((file, index) => {
    const hue = Math.round((index * 137.508) % 360);
    const light = index % 2 === 0 ? 62 : 70;
    colors.set(file, `hsl(${hue}, 78%, ${light}%)`);
  });
  return colors;
}

export function colorForNode(node: GNode, fileColors: Map<string, string>): string {
  if (node.type === "external") return EXTERNAL_COLOR;
  return fileColors.get(node.file_path) ?? "#9aa0b4";
}

export const EDGE_STYLE: Record<LinkType, { color: string; label: string; hint: string }> = {
  calls: { color: "#86efac", label: "Calls", hint: "function runs another function" },
  depends: { color: "#f9a8d4", label: "Depends", hint: "FastAPI Depends injection" },
  imports: { color: "#fdba74", label: "Imports", hint: "file imports a module" },
  contains: { color: "#94a3b8", label: "Contains", hint: "file or class holds a definition" },
};

export const EDGE_ORDER: LinkType[] = ["calls", "depends", "imports", "contains"];

export function withAlpha(hsl: string, alpha: number): string {
  if (hsl.startsWith("hsl(")) return hsl.replace("hsl(", "hsla(").replace(")", `, ${alpha})`);
  if (hsl.startsWith("#") && hsl.length === 7) {
    const value = Math.round(alpha * 255).toString(16).padStart(2, "0");
    return `${hsl}${value}`;
  }
  return hsl;
}
