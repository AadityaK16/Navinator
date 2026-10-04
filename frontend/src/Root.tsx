import { useCallback, useEffect, useState } from "react";
import App from "./App";
import { activateRepo, deleteRepo, fetchRepos, uploadRepo } from "./api";
import { filesFromDrop, filesFromInput, RepoPicker, type PickedFile } from "./RepoPicker";
import type { RepoInfo, RepoList } from "./types";

const DEMO: RepoInfo = { id: "demo", name: "full-stack-fastapi-template", kind: "demo", files: null };

/** Owns which repo is showing. Switching remounts App so every view starts fresh. */
export default function Root() {
  const [list, setList] = useState<RepoList | null>(null);
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    fetchRepos()
      .then(setList)
      .catch(() => setList({ active: DEMO.id, repos: [DEMO] }));
  }, []);

  const run = useCallback(async (label: string, task: () => Promise<RepoList>) => {
    setBusy(label);
    setError(null);
    try {
      setList(await task());
      setGeneration((g) => g + 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, []);

  const upload = useCallback(
    (picked: Promise<{ name: string; files: PickedFile[] } | null>) =>
      void run("Reading and parsing the folder…", async () => {
        const result = await picked;
        if (!result) throw new Error("Drop a folder, not a single file.");
        if (result.files.length === 0) throw new Error(`No Python files in ${result.name}.`);
        return uploadRepo(result.name, result.files);
      }),
    [run],
  );

  useEffect(() => {
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget == null) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      setDragging(false);
      upload(filesFromDrop(event.dataTransfer.items));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [upload]);

  if (!list) {
    return (
      <main className="blocker">
        <p className="kicker">Call path</p>
        <h1>RepoNav</h1>
        <p>Loading…</p>
      </main>
    );
  }

  const repo = list.repos.find((r) => r.id === list.active) ?? DEMO;
  const picker = (
    <RepoPicker
      list={list}
      busy={busy}
      error={error}
      onSwitch={(id) => void run(`Parsing ${list.repos.find((r) => r.id === id)?.name ?? id}…`, () => activateRepo(id))}
      onUpload={(files) => upload(filesFromInput(files))}
      onRemove={(id) => void run("Removing…", () => deleteRepo(id))}
    />
  );

  return (
    <>
      <App key={`${list.active}#${generation}`} repo={repo} repoPicker={picker} />
      {dragging && (
        <div className="drop-overlay">
          <p>Drop a folder to map its Python code</p>
        </div>
      )}
    </>
  );
}
