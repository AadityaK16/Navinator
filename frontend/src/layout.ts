import { useCallback, useRef, useState, useSyncExternalStore } from "react";

export type Size = { width: number; height: number };

// Callback ref, so it attaches even when the element mounts after a loading screen.
export function useElementSize<T extends HTMLElement>(): [(el: T | null) => void, Size] {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const frame = useRef(0);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const width = Math.round(entry.contentRect.width);
        const height = Math.round(entry.contentRect.height);
        setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      });
    });
    observer.current.observe(el);
  }, []);
  return [ref, size];
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
  );
}
