import { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { fetchNode } from "./api";
import type { GNode, NodeDetail } from "./types";

type Props = {
  nodes: GNode[];
  selected: NodeDetail | null;
  colorOf: (path: string) => string | undefined;
};

/** Every file in the repo, one at a time, full screen. Monaco is configured in Inspector.tsx. */
export function CodeView({ nodes, selected, colorOf }: Props) {
  const files = useMemo(
    () => nodes.filter((n) => n.type === "file" && n.file_path).sort((a, b) => a.file_path.localeCompare(b.file_path)),
    [nodes],
  );
  const selectedFile = selected?.file_path ? files.find((f) => f.file_path === selected.file_path) : undefined;
  const [fileId, setFileId] = useState<string | null>(selectedFile?.id ?? files[0]?.id ?? null);
  const [source, setSource] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    setError(null);
    fetchNode(fileId)
      .then((detail) => {
        if (!cancelled) setSource({ id: fileId, text: detail.file_source ?? "" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the file");
      });
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  const current = files.find((f) => f.id === fileId);
  // Highlight the selected symbol when its file is the one on screen.
  const highlight = selected && current && selected.file_path === current.file_path && selected.type !== "file" ? selected : null;

  useEffect(() => {
    const editor = editorRef.current;
    decorations.current?.clear();
    if (!editor || !source || source.id !== fileId) return;
    if (!highlight) {
      editor.setScrollTop(0);
      return;
    }
    const start = Math.max(highlight.line_start, 1);
    const end = Math.max(highlight.line_end || start, start);
    editor.revealLineInCenter(start);
    decorations.current = editor.createDecorationsCollection([
      { range: new monaco.Range(start, 1, end, 1), options: { isWholeLine: true, className: "hl-line" } },
    ]);
  }, [source, fileId, highlight]);

  const shown = filter.trim() ? files.filter((f) => f.file_path.toLowerCase().includes(filter.trim().toLowerCase())) : files;

  return (
    <section className="codeview" aria-label="All code">
      <aside className="cv-files">
        <input value={filter} placeholder={`Filter ${files.length} files`} onChange={(event) => setFilter(event.target.value)} />
        <ul>
          {shown.map((f) => {
            const slash = f.file_path.lastIndexOf("/");
            return (
              <li key={f.id}>
                <button type="button" className={f.id === fileId ? "cv-file on" : "cv-file"} onClick={() => setFileId(f.id)}>
                  <i style={{ background: colorOf(f.file_path) ?? "#9aa0b4" }} />
                  <span className="cv-dir">{slash >= 0 ? f.file_path.slice(0, slash + 1) : ""}</span>
                  <span className="cv-name">{f.file_path.slice(slash + 1)}</span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className="empty">No file matches.</li>}
        </ul>
      </aside>
      <div className="cv-main">
        <header>
          <strong>{current?.file_path ?? "No file"}</strong>
          {highlight && (
            <span className="evidence">
              {highlight.label} · lines {highlight.line_start}–{highlight.line_end}
            </span>
          )}
        </header>
        {error ? (
          <p className="stream-error">{error}</p>
        ) : (
          <Editor
            height="100%"
            theme="vs-dark"
            language="python"
            value={source?.id === fileId ? source.text : ""}
            options={{ readOnly: true, minimap: { enabled: true }, scrollBeyondLastLine: false, fontSize: 13 }}
            onMount={(editor) => {
              editorRef.current = editor;
            }}
          />
        )}
      </div>
    </section>
  );
}
