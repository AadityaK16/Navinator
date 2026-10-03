import type { GNode } from "./types";

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
