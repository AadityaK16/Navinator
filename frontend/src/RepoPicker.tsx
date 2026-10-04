import { useEffect, useRef } from "react";
import type { RepoInfo, RepoList } from "./types";

// Folders the parser skips anyway; leaving them out keeps uploads small.
const SKIP = new Set(["node_modules", ".git", ".venv", "venv", "env", "__pycache__", "site-packages", "build", "dist"]);

export type PickedFile = { path: string; content: string };

function keep(path: string): boolean {
  return path.endsWith(".py") && !path.split("/").some((part) => SKIP.has(part));
}

/** Split "myrepo/app/main.py" into the folder name and paths inside it. */
async function collect(entries: { path: string; file: File }[]): Promise<{ name: string; files: PickedFile[] }> {
  const name = entries[0]?.path.split("/")[0] || "repo";
  const files = await Promise.all(
    entries
      .filter((e) => keep(e.path))
      .map(async (e) => ({ path: e.path.split("/").slice(1).join("/"), content: await e.file.text() })),
  );
  return { name, files };
}

export function filesFromInput(list: FileList): Promise<{ name: string; files: PickedFile[] }> {
  return collect([...list].map((file) => ({ path: file.webkitRelativePath || file.name, file })));
}

function readDir(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  return new Promise((resolve, reject) => {
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
    next();
  });
}

async function walk(entry: FileSystemEntry, prefix: string, out: { path: string; file: File }[]): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    if (!keep(path)) return;
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ path, file });
  } else if (entry.isDirectory && !SKIP.has(entry.name)) {
    for (const child of await readDir(entry as FileSystemDirectoryEntry)) await walk(child, path, out);
  }
}

export async function filesFromDrop(items: DataTransferItemList): Promise<{ name: string; files: PickedFile[] } | null> {
  const root = [...items].map((item) => item.webkitGetAsEntry()).find((entry) => entry?.isDirectory);
  if (!root) return null;
  const out: { path: string; file: File }[] = [];
  await walk(root, "", out);
  return { ...(await collect(out)), name: root.name };
}

const KIND_LABEL: Record<RepoInfo["kind"], string> = { demo: "Demo", sample: "Samples", upload: "Your uploads" };

type Props = {
  list: RepoList;
  busy: string | null;
  error: string | null;
  onSwitch: (id: string) => void;
  onUpload: (files: FileList) => void;
  onRemove: (id: string) => void;
};

export function RepoPicker({ list, busy, error, onSwitch, onUpload, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // React has no typed prop for folder pickers.
    inputRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  const active = list.repos.find((r) => r.id === list.active);
  const kinds = (["demo", "sample", "upload"] as const).filter((kind) => list.repos.some((r) => r.kind === kind));

  return (
    <section className="repo-picker" aria-label="Repository">
      <div className="repo-row">
        <select value={list.active} disabled={busy != null} onChange={(event) => onSwitch(event.target.value)} aria-label="Repository">
          {kinds.map((kind) => (
            <optgroup key={kind} label={KIND_LABEL[kind]}>
              {list.repos
                .filter((r) => r.kind === kind)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.files != null ? ` · ${r.files} files` : ""}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <button type="button" className="ghost" disabled={busy != null} onClick={() => inputRef.current?.click()}>
          Upload folder
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files?.length) onUpload(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {busy ? (
        <p className="muted small">{busy}</p>
      ) : error ? (
        <p className="stream-error">{error}</p>
      ) : (
        <p className="muted small">
          Pick a folder of Python code, or drop one anywhere on the page.
          {active?.kind === "upload" && (
            <>
              {" "}
              <button type="button" className="link" onClick={() => onRemove(active.id)}>
                Remove this upload
              </button>
            </>
          )}
        </p>
      )}
    </section>
  );
}
