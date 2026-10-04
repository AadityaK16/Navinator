import { useEffect, useRef, useState } from "react";
import type { History } from "./types";

type Props = {
  history: History;
  index: number | null;
  onIndex: (index: number | null) => void;
  playing: boolean;
  onPlaying: (playing: boolean) => void;
};

const STEP_MS = 900;
const SPEEDS = [1, 1.5, 2] as const;
const SPEED_KEY = "reponav.replaySpeed";

function savedSpeed(): number {
  const value = Number(window.localStorage.getItem(SPEED_KEY));
  return SPEEDS.includes(value as (typeof SPEEDS)[number]) ? value : 1;
}

export function Timeline({ history, index, onIndex, playing, onPlaying }: Props) {
  const last = history.snapshots.length - 1;
  const at = index ?? last;
  const snap = history.snapshots[at];
  const timer = useRef<number | null>(null);
  const [speed, setSpeed] = useState(savedSpeed);

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setTimeout(() => {
      if (at >= last) {
        onPlaying(false);
        onIndex(null);
        return;
      }
      onIndex(at + 1);
    }, STEP_MS / speed);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [at, last, onIndex, onPlaying, playing, speed]);

  const max = Math.max(...history.snapshots.map((s) => s.nodes), 1);

  return (
    <section className="timeline" aria-label="Code history">
      <div className="timeline-head">
        <strong>Time machine</strong>
        <span>{history.snapshots.length} changes since {history.snapshots[0]?.date.slice(0, 4)}</span>
      </div>
      <div className="spark" aria-hidden>
        {history.snapshots.map((s, i) => (
          <button
            key={s.sha}
            type="button"
            className={i === at ? "bar on" : i < at ? "bar past" : "bar"}
            style={{ height: `${Math.max(12, (s.nodes / max) * 100)}%` }}
            title={`${s.date} · ${s.nodes} symbols`}
            onClick={() => {
              onPlaying(false);
              onIndex(i === last ? null : i);
            }}
          />
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={last}
        value={at}
        aria-label="Commit"
        onChange={(event) => {
          onPlaying(false);
          const value = Number(event.target.value);
          onIndex(value === last ? null : value);
        }}
      />
      {snap && (
        <div className="commit">
          <span className="commit-date">
            {snap.date} · <code>{snap.sha}</code>
          </span>
          <span className="commit-subject">{snap.subject}</span>
          <span className="commit-stats">
            <b className="add">+{snap.added.length}</b> <b className="del">−{snap.removed.length}</b> · {snap.nodes} symbols ·{" "}
            {snap.files} files
          </span>
        </div>
      )}
      <div className="timeline-actions">
        <button
          type="button"
          onClick={() => {
            if (playing) {
              onPlaying(false);
              return;
            }
            if (index == null) onIndex(0);
            onPlaying(true);
          }}
        >
          {playing ? "Pause" : index == null ? "Replay history" : "Play"}
        </button>
        {index != null && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              onPlaying(false);
              onIndex(null);
            }}
          >
            Back to today
          </button>
        )}
        <div className="speed" role="group" aria-label="Replay speed">
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              className={value === speed ? "on" : ""}
              aria-pressed={value === speed}
              onClick={() => {
                setSpeed(value);
                window.localStorage.setItem(SPEED_KEY, String(value));
              }}
            >
              {value}x
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
