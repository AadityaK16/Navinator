import type { TourStop } from "./types";
import type { VoiceStatus } from "./voice";

type Props = {
  stops: TourStop[];
  index: number;
  playing: boolean;
  finished: boolean;
  narratedBy: string;
  voice: string;
  voices: string[];
  grokVoice: boolean;
  voiceStatus: VoiceStatus | null;
  onVoice: (voice: string) => void;
  onBack: () => void;
  onToggle: () => void;
  onNext: () => void;
  onExit: () => void;
  onJump: (index: number) => void;
};

function shortName(id: string): string {
  return id.split(".").pop() ?? id;
}

export function TourBar({
  stops,
  index,
  playing,
  finished,
  narratedBy,
  voice,
  voices,
  grokVoice,
  voiceStatus,
  onVoice,
  onBack,
  onToggle,
  onNext,
  onExit,
  onJump,
}: Props) {
  const stop = stops[index];
  return (
    <section className="tourbar" aria-label="Tour controls">
      <div className="tour-top">
        <span className="tour-count">
          Stop {index + 1} of {stops.length}
        </span>
        <strong className="tour-name">{stop ? shortName(stop.node_id) : ""}</strong>
        <span className="tour-src">{narratedBy === "grok" ? "Narration by Grok" : narratedBy === "original" ? "Saved narration" : `Narration by ${narratedBy}`}</span>
      </div>
      <div className="dots">
        {stops.map((s, i) => (
          <button
            key={`${s.node_id}-${i}`}
            type="button"
            className={i === index ? "dot on" : i < index ? "dot past" : "dot"}
            title={shortName(s.node_id)}
            aria-label={`Go to stop ${i + 1}`}
            onClick={() => onJump(i)}
          />
        ))}
      </div>
      <div className="tour-controls">
        <button type="button" className="ghost" onClick={onBack} disabled={index === 0} title="Back (←)">
          ◀ Back
        </button>
        <button type="button" onClick={onToggle} title="Pause or play (Space)">
          {playing ? "❚❚ Pause" : finished ? "↺ Replay" : "▶ Play"}
        </button>
        <button type="button" className="ghost" onClick={onNext} title="Next (→)">
          Next ▶
        </button>
        <button type="button" className="ghost exit" onClick={onExit} title="Leave the tour (Esc)">
          ✕ Exit tour
        </button>
      </div>
      <div className="tour-voice">
        <label htmlFor="voice">Voice</label>
        <select id="voice" value={voice} onChange={(event) => onVoice(event.target.value)}>
          {grokVoice &&
            voices.map((v) => (
              <option key={v} value={v}>
                Grok · {v[0].toUpperCase() + v.slice(1)}
              </option>
            ))}
          <option value="browser">Browser voice</option>
        </select>
        {voiceStatus?.reason && <span className="voice-note">Grok voice failed, using browser voice: {voiceStatus.reason}</span>}
      </div>
    </section>
  );
}
