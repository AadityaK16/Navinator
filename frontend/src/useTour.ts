import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchNode } from "./api";
import type { NodeDetail, TourStop } from "./types";
import { prefetchGrok, speakText, type Speech, type VoiceChoice, type VoiceStatus } from "./voice";

const GAP_MS = 650;

export type TourState = {
  question: string;
  stops: TourStop[];
  narratedBy: string;
};

type Options = {
  onStop: (detail: NodeDetail, stop: TourStop) => void;
  fly: (nodeId: string) => void;
  voice: VoiceChoice;
};

// One stop at a time, driven by `index`. Auto-play advances when the speech for
// a stop ends; Back, Next and Pause just move the index or the play flag.
export function useTour({ onStop, fly, voice }: Options) {
  const [tour, setTour] = useState<TourState | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);

  const playingRef = useRef(false);
  const speech = useRef<Speech | null>(null);
  const ended = useRef(false);
  const startSpeech = useRef<(() => void) | null>(null);
  const advanceTimer = useRef<number | null>(null);
  const tourRef = useRef<TourState | null>(null);
  const indexRef = useRef(0);
  const callbacks = useRef({ onStop, fly, voice });

  // Keep the latest values where timers and callbacks can read them.
  useLayoutEffect(() => {
    callbacks.current = { onStop, fly, voice };
    tourRef.current = tour;
    indexRef.current = index;
  });

  const clearAdvance = () => {
    if (advanceTimer.current != null) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
  };

  const scheduleAdvance = useCallback(() => {
    clearAdvance();
    advanceTimer.current = window.setTimeout(() => {
      const current = tourRef.current;
      if (!current || !playingRef.current) return;
      if (indexRef.current < current.stops.length - 1) {
        setIndex(indexRef.current + 1);
      } else {
        playingRef.current = false;
        setPlaying(false);
        setFinished(true);
      }
    }, GAP_MS);
  }, []);

  useEffect(() => {
    if (!tour) return;
    const stop = tour.stops[index];
    if (!stop) return;
    let cancelled = false;
    ended.current = false;
    clearAdvance();

    const say = () => {
      if (cancelled || speech.current) return;
      const { voice: choice } = callbacks.current;
      const spoken = speakText(stop.narration, choice, setVoiceStatus);
      speech.current = spoken;
      const next = tour.stops[index + 1];
      if (next && choice.kind === "grok") void prefetchGrok(next.narration, choice.voice).catch(() => undefined);
      void spoken.done.then((end) => {
        if (cancelled || end === "stopped") return;
        ended.current = true;
        if (playingRef.current) scheduleAdvance();
      });
    };
    startSpeech.current = say;

    fetchNode(stop.node_id)
      .then((detail) => {
        if (cancelled) return;
        callbacks.current.onStop({ ...detail, evidence: stop.evidence, narration: stop.narration }, stop);
      })
      .catch(() => undefined);
    callbacks.current.fly(stop.node_id);
    if (playingRef.current) say();

    return () => {
      cancelled = true;
      clearAdvance();
      speech.current?.stop();
      speech.current = null;
      startSpeech.current = null;
    };
  }, [tour, index, nonce, scheduleAdvance]);

  const start = useCallback((next: TourState) => {
    playingRef.current = true;
    setPlaying(true);
    setFinished(false);
    setIndex(0);
    setTour(next);
    setNonce((n) => n + 1);
  }, []);

  const goTo = useCallback((target: number) => {
    const current = tourRef.current;
    if (!current) return;
    const clamped = Math.max(0, Math.min(current.stops.length - 1, target));
    setFinished(false);
    if (clamped === indexRef.current) setNonce((n) => n + 1);
    else setIndex(clamped);
  }, []);

  const next = useCallback(() => {
    const current = tourRef.current;
    if (!current) return;
    if (indexRef.current >= current.stops.length - 1) {
      speech.current?.stop();
      playingRef.current = false;
      setPlaying(false);
      setFinished(true);
      return;
    }
    goTo(indexRef.current + 1);
  }, [goTo]);

  const back = useCallback(() => goTo(indexRef.current - 1), [goTo]);

  const toggle = useCallback(() => {
    if (!tourRef.current) return;
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
      clearAdvance();
      speech.current?.pause();
      return;
    }
    playingRef.current = true;
    setPlaying(true);
    if (finished) {
      setFinished(false);
      goTo(0);
      return;
    }
    if (ended.current) scheduleAdvance();
    else if (speech.current) speech.current.resume();
    else startSpeech.current?.();
  }, [finished, goTo, scheduleAdvance]);

  const exit = useCallback(() => {
    clearAdvance();
    speech.current?.stop();
    speech.current = null;
    playingRef.current = false;
    setPlaying(false);
    setFinished(false);
    setTour(null);
  }, []);

  return { tour, index, playing, finished, voiceStatus, start, next, back, toggle, exit, goTo };
}
