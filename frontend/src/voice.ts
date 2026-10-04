import { fetchSpeech } from "./api";

export type SpeechEnd = "ended" | "stopped";

export type Speech = {
  done: Promise<SpeechEnd>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
};

export type VoiceChoice = { kind: "grok"; voice: string } | { kind: "browser" };

export type VoiceStatus = { using: "grok" | "browser"; reason?: string };

// Grok audio is cached per voice + text, so Back replays instantly and the next
// stop can be fetched while the current one is still talking.
const audioUrls = new Map<string, Promise<string>>();

function cacheKey(voice: string, text: string): string {
  return `${voice}\u0000${text}`;
}

export function prefetchGrok(text: string, voice: string): Promise<string> {
  const key = cacheKey(voice, text);
  let pending = audioUrls.get(key);
  if (!pending) {
    pending = fetchSpeech(text, voice).then((blob) => URL.createObjectURL(blob));
    pending.catch(() => audioUrls.delete(key));
    audioUrls.set(key, pending);
  }
  return pending;
}

function browserSpeech(text: string): Speech {
  let settle: (end: SpeechEnd) => void = () => {};
  const done = new Promise<SpeechEnd>((resolve) => {
    settle = resolve;
  });
  let finished = false;
  let cap = 0;
  const finish = (end: SpeechEnd) => {
    if (finished) return;
    finished = true;
    window.clearTimeout(cap);
    settle(end);
  };
  if (typeof speechSynthesis === "undefined") {
    // No speech engine: give the reader time based on length instead.
    const wait = Math.max(2500, text.split(/\s+/).length * 330);
    const timer = window.setTimeout(() => finish("ended"), wait);
    return {
      done,
      pause: () => window.clearTimeout(timer),
      resume: () => finish("ended"),
      stop: () => {
        window.clearTimeout(timer);
        finish("stopped");
      },
    };
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;
  const local = speechSynthesis.getVoices().find((voice) => voice.localService && voice.lang.startsWith("en"));
  if (local) utterance.voice = local;
  // Some browsers never fire onend; cap the wait by length.
  cap = window.setTimeout(() => finish("ended"), Math.max(8000, text.split(/\s+/).length * 600));
  utterance.onend = () => finish("ended");
  utterance.onerror = () => finish("ended");
  speechSynthesis.speak(utterance);
  return {
    done,
    pause: () => {
      window.clearTimeout(cap);
      speechSynthesis.pause();
    },
    resume: () => {
      speechSynthesis.resume();
      cap = window.setTimeout(() => finish("ended"), Math.max(8000, text.split(/\s+/).length * 600));
    },
    stop: () => {
      speechSynthesis.cancel();
      finish("stopped");
    },
  };
}

function grokSpeech(text: string, voice: string, onFallback: (reason: string) => void): Speech {
  let settle: (end: SpeechEnd) => void = () => {};
  const done = new Promise<SpeechEnd>((resolve) => {
    settle = resolve;
  });
  let finished = false;
  let paused = false;
  let stopped = false;
  let audio: HTMLAudioElement | null = null;
  let fallback: Speech | null = null;
  const finish = (end: SpeechEnd) => {
    if (finished) return;
    finished = true;
    settle(end);
  };

  prefetchGrok(text, voice)
    .then((url) => {
      if (stopped) return;
      audio = new Audio(url);
      audio.onended = () => finish("ended");
      audio.onerror = () => finish("ended");
      if (!paused) void audio.play().catch(() => finish("ended"));
    })
    .catch((error: unknown) => {
      if (stopped) return;
      onFallback(error instanceof Error ? error.message : "Grok voice failed");
      fallback = browserSpeech(text);
      if (paused) fallback.pause();
      void fallback.done.then(finish);
    });

  return {
    done,
    pause: () => {
      paused = true;
      audio?.pause();
      fallback?.pause();
    },
    resume: () => {
      paused = false;
      if (audio) void audio.play().catch(() => finish("ended"));
      fallback?.resume();
    },
    stop: () => {
      stopped = true;
      audio?.pause();
      fallback?.stop();
      finish("stopped");
    },
  };
}

export function speakText(text: string, choice: VoiceChoice, onStatus: (status: VoiceStatus) => void): Speech {
  if (choice.kind === "grok") {
    onStatus({ using: "grok" });
    return grokSpeech(text, choice.voice, (reason) => onStatus({ using: "browser", reason }));
  }
  onStatus({ using: "browser" });
  return browserSpeech(text);
}

export function stopAllSpeech(): void {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
