import { KIND, RELATION } from "./knowledgeStyle";
import type { GNode, KLink, KNode, KnowledgeKind } from "./types";

export function ShapeIcon({ kind }: { kind: KnowledgeKind }) {
  const { color } = KIND[kind];
  return (
    <svg className="kg-icon" viewBox="0 0 12 12" aria-hidden="true">
      {kind === "topic" && <circle cx="6" cy="6" r="4.4" fill="none" stroke={color} strokeWidth="1.5" />}
      {kind === "architecture" && (
        <>
          <circle cx="6" cy="6" r="3.6" fill={color} />
          <circle cx="6" cy="6" r="5.4" fill="none" stroke={color} strokeOpacity="0.45" />
        </>
      )}
      {kind === "concept" && <circle cx="6" cy="6" r="3.6" fill={color} />}
      {kind === "decision" && <polygon points="6,1.6 10.4,6 6,10.4 1.6,6" fill={color} />}
      {kind === "function" && <rect x="3" y="3" width="6" height="6" fill={color} />}
    </svg>
  );
}

type Props = {
  node: KNode;
  links: KLink[];
  byId: Map<string, KNode>;
  codeNodes: Record<string, GNode>;
  clusterLabel: string;
  onSelect: (id: string) => void;
  onZoomCluster: () => void;
  onOpenCode: (ref: string) => void;
  onClose: () => void;
};

function codeLocation(node: GNode | undefined, ref: string): string {
  if (!node) return ref;
  if (node.type === "file") return node.file_path;
  return `${node.file_path}:${node.line_start}`;
}

export function KnowledgeDetail({
  node,
  links,
  byId,
  codeNodes,
  clusterLabel,
  onSelect,
  onZoomCluster,
  onOpenCode,
  onClose,
}: Props) {
  const rows = links
    .map((link) => {
      const outgoing = link.source === node.id;
      const other = byId.get(String(outgoing ? link.target : link.source));
      return other ? { link, other, label: RELATION[link.relation][outgoing ? 0 : 1] } : null;
    })
    .filter((row) => row != null)
    // Code edges first so verified structure reads before interpretation.
    .sort((a, b) => Number(b.link.verified) - Number(a.link.verified) || a.label.localeCompare(b.label));

  const fnRef = node.kind === "function" ? node.code_refs[0] : undefined;

  return (
    <aside className="kg-detail" aria-label={`${node.title} details`}>
      <header>
        <p className="kg-kind-label">
          <ShapeIcon kind={node.kind} /> {KIND[node.kind].label}
          {node.origin === "agent" && <span className="kg-badge">agent-suggested</span>}
        </p>
        <button type="button" className="ghost kg-close" aria-label="Close details" onClick={onClose}>
          ×
        </button>
      </header>
      <h2 className={node.kind === "function" ? "mono" : undefined}>{node.title}</h2>
      <p className="kg-summary">{node.summary}</p>
      <button type="button" className="ghost kg-cluster" onClick={onZoomCluster}>
        {clusterLabel} · zoom to cluster
      </button>

      {fnRef && (
        <button type="button" className="kg-open" onClick={() => onOpenCode(fnRef)}>
          Open in code graph
          <small>{codeLocation(codeNodes[fnRef], fnRef)}</small>
        </button>
      )}

      {!fnRef && node.code_refs.length > 0 && (
        <>
          <h3>In the code</h3>
          <ul className="kg-list">
            {node.code_refs.map((ref) => (
              <li key={ref}>
                <button type="button" className="kg-row" onClick={() => onOpenCode(ref)}>
                  <span className="mono">{codeLocation(codeNodes[ref], ref)}</span>
                  <small>open source</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {rows.length > 0 && (
        <>
          <h3>Relationships</h3>
          <ul className="kg-list">
            {rows.map(({ link, other, label }) => (
              <li key={`${String(link.source)}-${link.relation}-${String(link.target)}`}>
                <button type="button" className="kg-row" onClick={() => onSelect(other.id)}>
                  <span className="kg-rel">{label}</span>
                  <span className="kg-other">
                    <ShapeIcon kind={other.kind} />
                    <span className={other.kind === "function" ? "mono" : undefined}>{other.title}</span>
                  </span>
                  {link.verified ? (
                    <small className="kg-badge code" title="Confirmed by a parsed edge in the call graph">
                      code · {link.evidence}
                    </small>
                  ) : (
                    <small className="kg-badge" title="Curated interpretation, not a parsed code edge">
                      conceptual
                    </small>
                  )}
                  {link.note && <small className="kg-note">{link.note}</small>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
