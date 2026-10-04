export type Crumb = { key: string; label: string; color?: string; go: () => void };

type Props = {
  crumbs: Crumb[];
  onUp: () => void;
  onHome: () => void;
  canGoUp: boolean;
  codeView: boolean;
  onCodeView: () => void;
  view: "3d" | "2d";
  onView: (view: "3d" | "2d") => void;
};

export function NavBar({ crumbs, onUp, onHome, canGoUp, codeView, onCodeView, view, onView }: Props) {
  return (
    <nav className="navbar" aria-label="Where you are">
      <div className="viewswitch" role="tablist" aria-label="View">
        <button type="button" role="tab" aria-selected={view === "3d"} className={view === "3d" ? "on" : ""} onClick={() => onView("3d")}>
          3D
        </button>
        <button type="button" role="tab" aria-selected={view === "2d"} className={view === "2d" ? "on" : ""} onClick={() => onView("2d")}>
          2D flow
        </button>
      </div>
      <button type="button" className="nav-btn" onClick={onUp} disabled={!canGoUp} title="Up one level (Esc)">
        <span aria-hidden>↑</span> Up
      </button>
      <button type="button" className="nav-btn" onClick={onHome} title="Back to the full view">
        <span aria-hidden>⌂</span> Home
      </button>
      <ol className="crumbs">
        {crumbs.map((crumb, i) =>
          i === 0 ? (
            <li key={crumb.key}>
              <button
                type="button"
                className={codeView ? "crumb code-toggle on" : "crumb code-toggle"}
                aria-pressed={codeView}
                onClick={onCodeView}
                title={codeView ? "Back to the graph (Esc)" : "Read every file's source"}
              >
                {crumb.color && <i style={{ background: crumb.color }} />}
                {crumb.label}
              </button>
            </li>
          ) : (
          <li key={crumb.key}>
            {i > 0 && <span className="sep">›</span>}
            <button
              type="button"
              className={i === crumbs.length - 1 ? "crumb here" : "crumb"}
              onClick={crumb.go}
              disabled={i === crumbs.length - 1}
            >
              {crumb.color && <i style={{ background: crumb.color }} />}
              {crumb.label}
            </button>
          </li>
          ),
        )}
      </ol>
    </nav>
  );
}
