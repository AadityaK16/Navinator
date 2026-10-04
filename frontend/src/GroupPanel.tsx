import type { GNode } from "./types";

export type Group = {
  kind: "file" | "folder" | "custom";
  key: string;
  title: string;
  subtitle: string;
  ids: Set<string>;
};

export type Neighbour = { group: Group; calls: number; color: string };

type Props = {
  group: Group;
  members: GNode[];
  neighbours: Neighbour[];
  color: string;
  colorOf: (node: GNode) => string;
  onMember: (id: string) => void;
  onGroup: (group: Group) => void;
  onExit: () => void;
};

const KIND_LABEL: Record<string, string> = { file: "file", class: "class", function: "fn", method: "method" };

export function GroupPanel({ group, members, neighbours, color, colorOf, onMember, onGroup, onExit }: Props) {
  const counts = members.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});
  const listed = members.filter((n) => n.type !== "file").sort((a, b) =>
    a.file_path === b.file_path ? a.line_start - b.line_start : a.file_path.localeCompare(b.file_path),
  );

  return (
    <section className="group-panel" style={{ borderColor: color }}>
      <div className="group-head">
        <div>
          <p className="kicker" style={{ color }}>{group.kind === "file" ? "File group" : group.kind === "folder" ? "Folder" : "Group"}</p>
          <strong>{group.title}</strong>
          <span>{group.subtitle}</span>
        </div>
        <button type="button" className="ghost" onClick={onExit} title="Up one level (Esc)">
          ↑ Up
        </button>
      </div>
      <p className="group-stats">
        {counts.file ? `${counts.file} files · ` : ""}
        {counts.class ?? 0} classes · {(counts.function ?? 0) + (counts.method ?? 0)} functions
      </p>
      <ul className="members">
        {listed.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => onMember(n.id)}>
              <i style={{ background: colorOf(n) }} />
              <span className="m-name">{n.cls ? `${n.cls}.${n.label}` : n.label}</span>
              <small>
                {KIND_LABEL[n.type] ?? n.type} · {!n.file_path ? "browser" : group.kind === "file" ? `line ${n.line_start}` : `${n.file_path.split("/").pop()}:${n.line_start}`}
              </small>
            </button>
          </li>
        ))}
      </ul>
      {neighbours.length > 0 && (
        <>
          <p className="group-sub">Talks to</p>
          <div className="neighbours">
            {neighbours.slice(0, 8).map((nb) => (
              <button key={nb.group.key} type="button" className="chip on" onClick={() => onGroup(nb.group)}>
                <i style={{ background: nb.color }} />
                {nb.group.title} <small>{nb.calls}</small>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
