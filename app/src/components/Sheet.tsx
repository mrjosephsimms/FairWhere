// Draggable bottom sheet with three resting heights, like Find My's People panel.
import { useEffect, useRef, useState, type ReactNode } from "react";

export type Detent = "peek" | "mid" | "full";

function useViewportHeight() {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return h;
}

export function detentHeights(vh: number): Record<Detent, number> {
  return { peek: Math.min(236, vh * 0.4), mid: Math.round(vh * 0.52), full: vh - 64 };
}

export function Sheet({ detent, onDetent, onHeight, header, view, children }: {
  detent: Detent;
  onDetent: (d: Detent) => void;
  /** Resting height in px (not reported mid-drag), so the map can pad around it. */
  onHeight?: (px: number) => void;
  header: ReactNode;
  /** Changing this starts the content scrolled to the top (new tab / new person). */
  view?: string;
  children: ReactNode;
}) {
  const vh = useViewportHeight();
  const heights = detentHeights(vh);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; h: number; t: number; moved: boolean } | null>(null);
  const height = drag ?? heights[detent];

  const resting = heights[detent];
  useEffect(() => onHeight?.(resting), [resting, onHeight]);

  function down(e: React.PointerEvent) {
    start.current = { y: e.clientY, h: heights[detent], t: e.timeStamp, moved: false };
  }
  function move(e: React.PointerEvent) {
    const s = start.current;
    if (!s) return;
    const dy = e.clientY - s.y;
    if (!s.moved && Math.abs(dy) < 6) return;
    if (!s.moved) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    s.moved = true;
    setDrag(Math.min(Math.max(s.h - dy, heights.peek * 0.8), heights.full));
  }
  function up(e: React.PointerEvent) {
    const s = start.current;
    start.current = null;
    if (!s?.moved) return;
    const dy = e.clientY - s.y;
    const v = dy / Math.max(e.timeStamp - s.t, 1); // px/ms, + = downward
    const aim = s.h - dy - v * 180; // project a flick forward a little
    const order: Detent[] = ["peek", "mid", "full"];
    const best = order.reduce((a, b) => (Math.abs(heights[b] - aim) < Math.abs(heights[a] - aim) ? b : a));
    setDrag(null);
    onDetent(best);
  }

  return (
    <section className={`sheet${drag != null ? " dragging" : ""}`} style={{ height }}>
      <div className="sheet-grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <button className="handle" aria-label={detent === "full" ? "Collapse panel" : "Expand panel"}
          onClick={() => onDetent(detent === "full" ? "mid" : detent === "mid" ? "full" : "mid")} />
        {header}
      </div>
      <div className="sheet-body" key={view}>{children}</div>
    </section>
  );
}
