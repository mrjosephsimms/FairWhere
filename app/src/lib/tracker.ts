// Live GPS for your own round (Milestone 3, foreground). Runs only while you have a
// live round (HANDOFF §6): watches position, auto-advances the hole, works out
// yardage, spots ball hunts, and writes to the round sparingly (HANDOFF §4).
import { useEffect, useRef, useState } from "react";
import type { LatLng, PlayHole } from "./courses";
import { updateRoundPosition, type Round } from "./db";
import { makeHoleTracker } from "./holeDetect";
import { locateOnHole, makeSearchDetector, type HolePosition } from "./onCourse";

/** Write at most this often unless the hole or ball-hunt state changes. */
export const WRITE_EVERY_MS = 60000;
/** Fixes vaguer than this are ignored (indoors, cold start). */
const MAX_ACCURACY_M = 50;

export interface GpsState {
  status: "off" | "asking" | "on" | "denied" | "unavailable";
  fix: { pt: LatLng; acc: number; t: number } | null;
  /** Where you are on the hole you're playing; null when off the course. */
  pos: HolePosition | null;
  searchingSince: number | null;
}

const OFF: GpsState = { status: "off", fix: null, pos: null, searchingSince: null };

export function useRoundTracker(round: Round | undefined, seq: PlayHole[] | undefined): GpsState {
  const [state, setState] = useState<GpsState>(OFF);
  const hole = useRef(round?.hole ?? 1);
  hole.current = round?.hole ?? 1; // manual -/+ wins; GPS only ever moves forward
  const roundId = round?.status === "live" ? round.id : undefined;
  const riding = round?.mode !== "walking";

  useEffect(() => {
    if (!roundId || !seq) return setState(OFF);
    if (!("geolocation" in navigator)) return setState({ ...OFF, status: "unavailable" });
    setState({ ...OFF, status: "asking" });

    const lines = seq.map((h) => h.centerline);
    const onFix = makeHoleTracker();
    // Riders park the cart on the path while they play, so give them longer.
    const hunt = makeSearchDetector({ minMs: (riding ? 4 : 3) * 60000 });
    let lastWrite = 0, lastSearching: number | null = null, writing = false;

    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (p.coords.accuracy > MAX_ACCURACY_M) return;
        const pt: LatLng = [p.coords.latitude, p.coords.longitude], t = p.timestamp || Date.now();
        const r = onFix(lines, pt, hole.current);
        const now = r.offCourse ? hole.current : r.hole;
        const pos = r.offCourse ? null : locateOnHole(seq[now - 1], pt);
        const searchingSince = hunt(pt, t, pos);
        setState({ status: "on", fix: { pt, acc: p.coords.accuracy, t }, pos, searchingSince });

        const huntChanged = (searchingSince == null) !== (lastSearching == null);
        if (writing || (!r.change && !huntChanged && t - lastWrite < WRITE_EVERY_MS)) return;
        writing = true;
        lastWrite = t;
        lastSearching = searchingSince;
        if (r.change) hole.current = now;
        updateRoundPosition(roundId, {
          last_lat: pt[0], last_lng: pt[1], last_fix_at: new Date(t).toISOString(),
          hole_fraction: pos ? Math.min(Math.max(pos.frac, 0), 1) : null,
          searching_since: searchingSince ? new Date(searchingSince).toISOString() : null,
          ...(r.change ? { hole: now, hole_started_at: new Date(t).toISOString(), hole_fraction: 0 } : {}),
        })
          .catch(() => (lastWrite = 0)) // retry on the next fix
          .finally(() => (writing = false));
      },
      (e) => setState({ ...OFF, status: e.code === e.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [roundId, seq, riding]);

  return state;
}
