// Wording for alerts (in-app now; the iPhone push sender will reuse it) and for
// summarising someone's alert settings.
import type { Note, WatchSettings } from "./db";
import { fmtTime } from "./time";

export function paceWords(delta: number | null): string | null {
  if (delta == null) return null;
  const d = Math.round(delta);
  return Math.abs(d) <= 5 ? "On pace" : d < 0 ? `${-d} min ahead of pace` : `${d} min behind pace`;
}

export function describeNote(n: Note, name: string, course?: string): { title: string; body: string } {
  const eta = n.eta ? fmtTime(Date.parse(n.eta)) : null;
  switch (n.kind) {
    case "hole":
      return { title: `${name} finished hole ${n.hole}`, body: [paceWords(n.delta_min), eta && `done ~${eta}`].filter(Boolean).join(" · ") };
    case "soon": {
      const mins = n.eta ? Math.max(1, Math.round((Date.parse(n.eta) - Date.parse(n.created_at)) / 60000)) : null;
      return { title: mins ? `${name} is about ${mins} min from done` : `${name} is nearly done`, body: eta ? `Finishing ~${eta}` : "" };
    }
    case "tee_off":
      return { title: `${name} teed off`, body: course ?? "" };
    case "finished":
      return { title: `${name} finished${n.hole && n.hole < 18 ? ` after ${n.hole} holes` : ""}`, body: n.strokes ? `Score: ${n.strokes}` : course ?? "" };
    case "ball_hunt":
      return { title: `${name} might be looking for a ball 🔎`, body: n.hole ? `On hole ${n.hole}` : "" };
  }
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
