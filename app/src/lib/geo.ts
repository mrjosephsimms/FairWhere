// Where to draw a golfer on the map, computed on the viewer's device (no extra writes).
import type { LatLng, PlayHole } from "./courses";
import type { PaceEstimate } from "./pace";
import type { Round } from "./db";

/** A GPS fix older than this is ignored in favour of the pace-based guess. */
export const FIX_FRESH_MS = 15 * 60000;

/**
 * The golfer's map position as [lat, lng]:
 *  - live with a fresh GPS fix -> the fix
 *  - live without one -> `frac` of the way along the current hole (from the pace model)
 *  - not teed off yet -> the first tee
 *  - finished / stopped -> null (coordinates are deleted on finish, HANDOFF §6)
 */
export function roundPosition(round: Round, seq: PlayHole[], est: PaceEstimate, now: number): LatLng | null {
  if (round.status !== "live" || est.phase === "done") return null;
  if (est.phase === "pre") return seq[0]?.centerline[0] ?? null;
  const fresh =
    round.last_lat != null && round.last_lng != null && round.last_fix_at != null &&
    now - Date.parse(round.last_fix_at) < FIX_FRESH_MS;
  if (fresh) return [round.last_lat!, round.last_lng!];
  const hole = seq[Math.min(Math.max(round.hole, 1), seq.length) - 1];
  return hole ? alongLine(hole.centerline, est.frac ?? 0) : null;
}

/** Point `f` (0..1) of the way along a [lat, lng] polyline (flat-earth; fine at hole scale). */
export function alongLine(pts: LatLng[], f: number): LatLng {
  if (pts.length < 2) return pts[0];
  const k = Math.cos((pts[0][0] * Math.PI) / 180);
  const segs = pts.slice(1).map((b, i) => {
    const a = pts[i];
    return { a, b, d: Math.hypot(b[0] - a[0], (b[1] - a[1]) * k) };
  });
  let want = Math.min(Math.max(f, 0), 1) * segs.reduce((s, x) => s + x.d, 0);
  for (const { a, b, d } of segs) {
    if (want <= d && d > 0) return [a[0] + ((b[0] - a[0]) * want) / d, a[1] + ((b[1] - a[1]) * want) / d];
    want -= d;
  }
  return pts[pts.length - 1];
}

/** Compass bearing (degrees clockwise from north) from a to b. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const k = Math.cos((a[0] * Math.PI) / 180);
  return ((Math.atan2((b[1] - a[1]) * k, b[0] - a[0]) * 180) / Math.PI + 360) % 360;
}

/** [[west, south], [east, north]] around the given holes, for fitting the map to them. */
export function courseBounds(seq: PlayHole[]): [[number, number], [number, number]] {
  const pts = seq.flatMap((h) => h.centerline);
  const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}
