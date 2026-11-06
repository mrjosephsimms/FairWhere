// Draggable bottom sheet with two resting heights: "mid" (opens here, tall enough to show
// a round's details without scrolling) and "full". It sits on top of the tab bar, so its
// height is all usable space. When full, the grab bar turns into a down chevron you can tap.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type Detent = "mid" | "full";

/** Viewport height and the space below the sheet's bottom edge (the tab bar). */
function useLayout(ref: React.RefObject<HTMLElement | null>) {
  const [box, setBox] = useState(() => ({ vh: window.innerHeight, below: 0 }));
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      const vh = window.innerHeight;
      const below = el ? Math.max(0, Math.round(vh - el.getBoundingClientRect().bottom)) : 0;
      setBox((b) => (b.vh === vh && b.below === below ? b : { vh, below }));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ref]);
  return box;
}

/** Heights of the sheet itself. `vh` is the viewport, `below` the tab bar under the sheet. */
export function detentHeights(vh: number, below = 0): Record<Detent, number> {
  const room = vh - below;
  const full = room - 60; // keep the status bar / Dynamic Island clear
  return { mid: Math.min(full, Math.max(360, Math.round(room * 0.64))), full };
}

export function Sheet({ detent, onDetent, onHeight, header, view, children }: {
  detent: Detent;
  onDetent: (d: Detent) => void;
  /** Distance from the bottom of the screen to the sheet's top edge, at rest, so the map can pad around it. */
  onHeight?: (px: number) => void;
  header: ReactNode;
  /** Changing this starts the content scrolled to the top (new tab / new person). */
  view?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const { vh, below } = useLayout(ref);
  const heights = detentHeights(vh, below);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; h: number; t: number; moved: boolean } | null>(null);
  const height = drag ?? heights[detent];

  const resting = heights[detent] + below;
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
    // Below mid it only rubber-bands; there's no smaller resting size to fold into.
    const raw = s.h - dy;
    const h = raw < heights.mid ? heights.mid - (heights.mid - raw) * 0.3 : raw;
    setDrag(Math.min(h, heights.full));
  }
  function up(e: React.PointerEvent) {
    const s = start.current;
    start.current = null;
    if (!s?.moved) return;
    const dy = e.clientY - s.y;
    const v = dy / Math.max(e.timeStamp - s.t, 1); // px/ms, + = downward
    const aim = s.h - dy - v * 180; // project a flick forward a little
    setDrag(null);
    onDetent(aim > (heights.mid + heights.full) / 2 ? "full" : "mid");
  }

  const full = detent === "full";
  const chevron = full && drag == null;
  return (
    <section ref={ref} className={`sheet${drag != null ? " dragging" : ""}`} style={{ height }}>
      <div className="sheet-grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <button className="handle" aria-label={full ? "Collapse panel" : "Expand panel"} onClick={() => onDetent(full ? "mid" : "full")}>
          {chevron ? (
            <svg width="40" height="12" viewBox="0 0 44 12" aria-hidden>
              <path d="M4 3 L22 9 L40 3" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <i aria-hidden />
          )}
        </button>
        {header}
      </div>
      <div className="sheet-body" key={view}>{children}</div>
    </section>
  );
}
