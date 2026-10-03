import { useState } from "react";
import type { CustomGroup, Grouping } from "./grouping";

type Props = {
  groupings: Grouping[];
  activeId: string;
  busy: boolean;
  error: string | null;
  aiName: string | null;
  onAsk: (prompt: string) => void;
  onSwitch: (id: string) => void;
  onFocus: (group: CustomGroup) => void;
};

const EXAMPLES = [
  "Group by what each piece is responsible for",
  "Only show code that handles passwords and tokens",
  "Group by which API route uses it",
  "Split code that reads data from code that writes it",
];

export function RegroupPanel({ groupings, activeId, busy, error, aiName, onAsk, onSwitch, onFocus }: Props) {
  const [prompt, setPrompt] = useState("");
  const active = groupings.find((g) => g.id === activeId);
  const submit = (text: string) => {
    const value = text.trim();
    if (!value || busy) return;
    onAsk(value);
    setPrompt("");
  };

  return (
    <div className="regroup">
      <p className="lede">
        Ask for a different way to group the code. {aiName ? `${aiName} picks the groups` : "Without an AI key, it keeps the code that matches your words"}; every
        grouping stays in the list below so you can switch back.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(prompt);
        }}
      >
        <textarea
          rows={2}
          value={prompt}
          placeholder={active && active.groups.length ? "Refine this grouping, or ask for a new one" : "e.g. group by responsibility"}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(prompt);
            }
          }}
        />
        <button type="submit" disabled={busy || !prompt.trim()}>
          {busy ? "Regrouping…" : "Regroup"}
        </button>
      </form>
      <div className="examples">
        {EXAMPLES.map((example) => (
          <button key={example} type="button" className="ghost" disabled={busy} onClick={() => submit(example)}>
            {example}
          </button>
        ))}
      </div>
      {error && <p className="stream-error">{error}</p>}

      {active && active.groups.length > 0 && (
        <section className="active-grouping">
          <p className="group-sub">Now showing</p>
          <strong>{active.title}</strong>
          {active.summary && <p className="muted">{active.summary}</p>}
          {active.note && <p className="muted small">Fell back to keywords: {active.note}</p>}
          <ul className="cg-list">
            {active.groups.map((group) => (
              <li key={group.key}>
                <button type="button" onClick={() => onFocus(group)} title={group.why}>
                  <i style={{ background: group.color }} />
                  <span>{group.name}</span>
                  <small>{group.members.length}</small>
                </button>
              </li>
            ))}
          </ul>
          {active.hidden.size > 0 && <p className="muted small">{active.hidden.size} {active.hidden.size === 1 ? "symbol" : "symbols"} hidden because {active.hidden.size === 1 ? "it is" : "they are"} outside this focus.</p>}
        </section>
      )}

      <section className="grouping-history">
        <p className="group-sub">Your groupings</p>
        <ul>
          {groupings.map((g) => (
            <li key={g.id}>
              <button type="button" className={g.id === activeId ? "gh on" : "gh"} onClick={() => onSwitch(g.id)} disabled={busy}>
                <span className="gh-title">{g.title}</span>
                <small>{g.groups.length ? `${g.groups.length} groups · ${g.source}` : "folders and files"}</small>
                {g.prompt && <small className="gh-prompt">“{g.prompt}”</small>}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
