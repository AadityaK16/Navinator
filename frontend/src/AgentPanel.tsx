import type { ReactNode } from "react";
import { PRESET_QUESTIONS, type SearchHit } from "./types";

type Props = {
  question: string;
  onQuestion: (value: string) => void;
  onAsk: (question: string) => void;
  asking: boolean;
  ready: boolean;
  log: string[];
  error: string | null;
  search: string;
  onSearch: (value: string) => void;
  hits: SearchHit[];
  onJump: (id: string) => void;
  tab: "tour" | "regroup";
  onTab: (tab: "tour" | "regroup") => void;
  regroup: ReactNode;
};

export function AgentPanel({
  question,
  onQuestion,
  onAsk,
  asking,
  ready,
  log,
  error,
  search,
  onSearch,
  hits,
  onJump,
  tab,
  onTab,
  regroup,
}: Props) {
  const askDisabled = !ready || asking || !question.trim();
  return (
    <aside className="panel">
      <p className="kicker">Call path</p>
      <h1>RepoNav</h1>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "tour"} className={tab === "tour" ? "tab on" : "tab"} onClick={() => onTab("tour")}>
          Ask & tour
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "regroup"}
          className={tab === "regroup" ? "tab on" : "tab"}
          onClick={() => onTab("regroup")}
        >
          Regroup
        </button>
      </div>
      {tab === "regroup" ? (
        regroup
      ) : (
        <>
      <p className="lede">Follow a real call path through this backend.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onAsk(question);
        }}
      >
        <label htmlFor="question">Question</label>
        <textarea
          id="question"
          rows={3}
          value={question}
          placeholder="Ask how a request moves through the code"
          onChange={(event) => onQuestion(event.target.value)}
        />
        <button type="submit" disabled={askDisabled}>
          {!ready ? "Laying out the graph…" : asking ? "Tracing…" : "Ask"}
        </button>
      </form>
      <div className="presets">
        {PRESET_QUESTIONS.map((preset) => (
          <button key={preset} type="button" className="ghost" disabled={!ready || asking} onClick={() => onAsk(preset)}>
            {preset}
          </button>
        ))}
      </div>
      <label htmlFor="symbol">Jump to a symbol</label>
      <input
        id="symbol"
        value={search}
        placeholder="login, verify_password, create_user"
        onChange={(event) => onSearch(event.target.value)}
      />
      {hits.length > 0 && (
        <ul className="hits">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button type="button" className="hit" onClick={() => onJump(hit.id)}>
                <span>{hit.id}</span>
                <small>{hit.file || hit.type}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="log" aria-live="polite">
        {error && <p className="stream-error">{error}</p>}
        {log.length === 0 && !error && <p className="empty">Ask a question to fly the call path.</p>}
        {log.map((line, index) => (
          <p key={`${index}-${line}`}>{line}</p>
        ))}
      </div>
        </>
      )}
    </aside>
  );
}
