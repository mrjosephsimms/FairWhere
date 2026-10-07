// Wording for alerts (the text itself lives in supabase/functions/_shared/notes.ts so the
// iPhone push sender says exactly the same) and for summarising someone's alert settings.
import type { Note, WatchSettings } from "./db";
import { fmtTime } from "./time";
import { describeNote as describeShared, paceWords } from "../../../supabase/functions/_shared/notes";

export { paceWords };

export function describeNote(n: Note, name: string, course?: string): { title: string; body: string } {
  return describeShared(n, name, course, fmtTime);
}

export const NO_ALERTS: WatchSettings = { every_hole: false, holes: [], before_finish_min: null, tee_off: false, finished: false, ball_hunt: false };

export const isOff = (w: WatchSettings) =>
  !w.every_hole && !w.holes.length && w.before_finish_min == null && !w.tee_off && !w.finished && !w.ball_hunt;

/** "every hole · 30 min before done · when done", for the golfer's "who gets updates" line. */
export function summarizeWatch(w: WatchSettings): string {
  const holes = [...w.holes].sort((a, b) => a - b);
  const parts = [
    w.every_hole ? "every hole" : holes.length ? `hole${holes.length > 1 ? "s" : ""} ${holes.join(" & ")}` : null,
    w.before_finish_min ? `${w.before_finish_min} min before done` : null,
    w.tee_off ? "tee off" : null,
    w.finished ? "when done" : null,
    w.ball_hunt ? "ball hunts" : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
