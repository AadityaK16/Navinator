import type { RefObject } from "react";

export const SPLIT_MIN = 0.22;
export const SPLIT_MAX = 0.78;

const clamp = (value: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value));

type Props = {
  ratio: number;
  onRatio: (ratio: number) => void;
  onDragging: (dragging: boolean) => void;
  stacked: boolean;
  hidden: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
};

export function SplitDivider({ ratio, onRatio, onDragging, stacked, hidden, containerRef }: Props) {
  function track(x: number, y: number) {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    onRatio(clamp(stacked ? (y - box.top) / box.height : (x - box.left) / box.width));
  }

  return (
    <div
      role="separator"
      aria-label="Resize panes"
      aria-orientation={stacked ? "horizontal" : "vertical"}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={SPLIT_MIN * 100}
      aria-valuemax={SPLIT_MAX * 100}
      tabIndex={hidden ? -1 : 0}
      title="Drag to resize · double-click to center"
      className={`divider ${hidden ? "off" : ""}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onDragging(true);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) track(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        onDragging(false);
      }}
      onPointerCancel={() => onDragging(false)}
      onDoubleClick={() => onRatio(0.5)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.1 : 0.04;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") onRatio(clamp(ratio - step));
        else if (event.key === "ArrowRight" || event.key === "ArrowDown") onRatio(clamp(ratio + step));
        else if (event.key === "Home" || event.key === "Enter") onRatio(0.5);
        else return;
        event.preventDefault();
      }}
    >
      <span className="grip" />
    </div>
  );
}
