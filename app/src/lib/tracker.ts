// Live GPS for your own round. Runs only while you have a live round (HANDOFF §6), and
// in the iPhone app keeps running with the phone locked in a pocket (lib/location.ts):
// watches position, auto-advances the hole, works out yardage, spots ball hunts, and
// writes to the round sparingly (HANDOFF §4). Stops the moment the round isn't live
// (finished, auto-finished on leaving, stopped, or expired after 6 h).
import { useEffect, useRef, useState } from "react";
import type { LatLng, PlayHole } from "./courses";
import { endRound, updateRoundPosition, type Round } from "./db";
import { makeHoleTracker, nearestOnLine } from "./holeDetect";
import { makeLeaveDetector } from "./leaveCourse";
import { locateOnHole, makeSearchDetector, type HolePosition } from "./onCourse";
import { watchLocation } from "./location";

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
  /** Field-test numbers for the hidden GPS debug panel (MyRound: tap "Hole" 5 times). */
  debug: GpsDebug;
}

export interface GpsDebug {
  /** Fixes used / ignored as too vague, and position writes sent this session. */
  fixes: number;
  skipped: number;
  writes: number;
  /** What the hole detector currently thinks, and metres from that hole's line (or the next tee). */
  candidate: number | null;
  d: number | null;
}

const NO_DEBUG: GpsDebug = { fixes: 0, skipped: 0, writes: 0, candidate: null, d: null };
const OFF: GpsState = { status: "off", fix: null, pos: null, searchingSince: null, debug: NO_DEBUG };

/**
 * `onLeft` fires if the golfer clearly leaves the course without finishing (the round
 * is then finished for them, which stops sharing and wipes their location).
 */
export function useRoundTracker(round: Round | undefined, seq: PlayHole[] | undefined, onLeft?: () => void): GpsState {
  const [state, setState] = useState<GpsState>(OFF);
  const hole = useRef(round?.hole ?? 1);
  hole.current = round?.hole ?? 1; // manual -/+ wins; GPS only ever moves forward
  const roundId = round?.status === "live" ? round.id : undefined;
  const riding = round?.mode !== "walking";
  const leftCb = useRef(onLeft);
  leftCb.current = onLeft;
  // If their last saved fix was on the course, they've been there (survives a reload).
  const lastFix = useRef<LatLng | null>(null);
  lastFix.current = round?.last_lat != null && round?.last_lng != null ? [round.last_lat, round.last_lng] : null;

  useEffect(() => {
    if (!roundId || !seq) return setState(OFF);
    setState({ ...OFF, status: "asking" });

    const lines = seq.map((h) => h.centerline);
    const onFix = makeHoleTracker();
    // Riders park the cart on the path while they play, so give them longer.
    const hunt = makeSearchDetector({ minMs: (riding ? 4 : 3) * 60000 });
    let lastWrite = 0, lastSearching: number | null = null, writing = false, ended = false;
    const dbg: GpsDebug = { ...NO_DEBUG };
    const fromCourse = (pt: LatLng) => Math.min(...lines.map((l) => nearestOnLine(l, pt).d));
    const left = makeLeaveDetector({}, lastFix.current != null && fromCourse(lastFix.current) <= 200);

    const stop = watchLocation(
      (p) => {
        if (p.accuracy > MAX_ACCURACY_M) return void dbg.skipped++;
        dbg.fixes++;
        const pt: LatLng = [p.lat, p.lng], t = p.time;
        if (ended) return;
        // Forgot to finish and went home: finish it for them (stops sharing, wipes location).
        if (left(fromCourse(pt), t)) {
          ended = true;
          endRound(roundId, "done").then(() => leftCb.current?.()).catch(() => (ended = false));
          return;
        }
        const r = onFix(lines, pt, hole.current);
        const now = r.offCourse ? hole.current : r.hole;
        const pos = r.offCourse ? null : locateOnHole(seq[now - 1], pt);
        const searchingSince = hunt(pt, t, pos);
        dbg.candidate = r.offCourse ? null : r.hole;
        dbg.d = r.offCourse ? null : r.d;
        setState({ status: "on", fix: { pt, acc: p.accuracy, t }, pos, searchingSince, debug: { ...dbg } });

        const huntChanged = (searchingSince == null) !== (lastSearching == null);
        if (writing || (!r.change && !huntChanged && t - lastWrite < WRITE_EVERY_MS)) return;
        writing = true;
        lastWrite = t;
        lastSearching = searchingSince;
        dbg.writes++;
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
      (e) => setState({ ...OFF, status: e }),
      { background: true },
    );
    return stop;
  }, [roundId, seq, riding]);

  return state;
}
