import { useEffect, useRef } from "react";
import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import "monaco-editor/esm/vs/languages/definitions/python/register.js";
import "monaco-editor/min/vs/editor/editor.main.css";
import type { NodeDetail } from "./types";

self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

loader.config({ monaco });

type Props = {
  node: NodeDetail | null;
  open: boolean;
  onToggle: () => void;
  onBlast: (id: string) => void;
  blastActive: boolean;
  onClearBlast: () => void;
};

export function Inspector({ node, open, onToggle, onBlast, blastActive, onClearBlast }: Props) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const external = node?.type === "external";

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !node || external) return;
    const start = Math.max(node.line_start, 1);
    const end = Math.max(node.line_end || start, start);
    editor.revealLineInCenter(start);
    decorations.current?.clear();
    decorations.current = editor.createDecorationsCollection([
      {
        range: new monaco.Range(start, 1, end, 1),
        options: { isWholeLine: true, className: "hl-line" },
      },
    ]);
  }, [node, external]);

  const location = node && !external && node.file_path ? `${node.file_path}:${node.line_start}` : node?.label;

  return (
    <section className={`drawer ${open ? "open" : ""}`}>
      <header>
        <button type="button" className="ghost toggle" onClick={onToggle}>
          {open ? "Hide source" : "Show source"}
        </button>
        <div className="meta">
          <strong>{location || "Source"}</strong>
          {node?.evidence && <span className="evidence">{node.evidence}</span>}
        </div>
        {node && (
          <div className="drawer-actions">
            <button type="button" onClick={() => onBlast(node.id)}>
              What breaks if this changes?
            </button>
            {blastActive && (
              <button type="button" className="ghost" onClick={onClearBlast}>
                Clear blast view
              </button>
            )}
          </div>
        )}
      </header>
      {open && (
        <div className="drawer-body">
          {node?.narration && <p className="narration">{node.narration}</p>}
          {!node && <p className="empty">Select a stop or a node to read the source.</p>}
          {external && <p className="empty">No source; this is the browser request.</p>}
          {node && !external && (
            <Editor
              height="32vh"
              theme="vs-dark"
              language="python"
              value={node.file_source ?? ""}
              options={{ readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false }}
              onMount={(editor) => {
                editorRef.current = editor;
                const start = Math.max(node.line_start, 1);
                const end = Math.max(node.line_end || start, start);
                editor.revealLineInCenter(start);
                decorations.current = editor.createDecorationsCollection([
                  {
                    range: new monaco.Range(start, 1, end, 1),
                    options: { isWholeLine: true, className: "hl-line" },
                  },
                ]);
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}
