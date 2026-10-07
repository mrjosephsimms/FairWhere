// Alert wording, shared by the app's in-app alerts (app/src/lib/notify.ts) and the iPhone
// push sender (../push/index.ts), so both always say the same thing. No imports: this file
// runs in the browser bundle and in Deno.

export type NoteKind = "hole" | "soon" | "tee_off" | "finished" | "ball_hunt";

export interface NoteFields {
  kind: NoteKind;
  hole: number | null;
  eta: string | null;
  delta_min: number | null;
  strokes: number | null;
  created_at: string;
}

export function paceWords(delta: number | null): string | null {
  if (delta == null) return null;
  const d = Math.round(delta);
  return Math.abs(d) <= 5 ? "On pace" : d < 0 ? `${-d} min ahead of pace` : `${d} min behind pace`;
}

/** `fmtTime` formats a clock time for the reader (the app: the phone's zone; pushes: the recipient's). */
export function describeNote(
  n: NoteFields,
  name: string,
  course: string | undefined,
  fmtTime: (ms: number) => string,
): { title: string; body: string } {
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

/** A clock time in a given IANA zone, e.g. "2:16 PM" (pushes, where the server isn't in the reader's zone). */
export const clockIn = (tz: string) => (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
