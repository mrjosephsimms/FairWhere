// GPS fix -> current hole, with debounce. Ported from reference/holeDetect.js
// (HANDOFF §5). Used by Milestone 3 (background GPS); pure and tested now.
import type { LatLng } from "./courses";

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Metres between two points (equirectangular; accurate at course scale). */
export function distM(a: LatLng, b: LatLng): number {
  const la = rad((a[0] + b[0]) / 2);
  return Math.hypot(rad(b[1] - a[1]) * Math.cos(la) * R, rad(b[0] - a[0]) * R);
}

/** Closest point on a polyline: distance (m) and fraction (0..1) along its length. */
export function nearestOnLine(line: LatLng[], pt: LatLng): { d: number; frac: number } {
  if (line.length === 1) return { d: distM(line[0], pt), frac: 0 };
  let best: { d: number; frac: number } | null = null;
  let run = 0;
  const lens: number[] = [];
  for (let j = 1; j < line.length; j++) lens.push(distM(line[j - 1], line[j]));
  const total = lens.reduce((s, x) => s + x, 0) || 1;
  for (let j = 1; j < line.length; j++) {
    const a = line[j - 1], b = line[j], k = Math.cos(rad(a[0]));
    const ax = a[1] * k, ay = a[0], bx = b[1] * k, by = b[0], px = pt[1] * k, py = pt[0];
    const den = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / den));
    const proj: LatLng = [ay + (by - ay) * t, (ax + (bx - ax) * t) / k];
    const d = distM(pt, proj);
    if (!best || d < best.d) best = { d, frac: (run + lens[j - 1] * t) / total };
    run += lens[j - 1];
  }
  return best!;
}

export interface HoleHit {
  hole: number;
  d: number;
  frac: number;
}

/**
 * Candidate hole for a fix. Only considers current-2 .. current+2 so crossing
 * an adjacent fairway doesn't jump the round. null = off course (> offCourseM).
 * @param lines centerlines in play order (index 0 = hole 1)
 */
export function detectHole(lines: LatLng[][], pt: LatLng, currentHole: number, offCourseM = 120): HoleHit | null {
  let best: HoleHit | null = null;
  for (let i = Math.max(0, currentHole - 3); i < Math.min(lines.length, currentHole + 2); i++) {
    const r = nearestOnLine(lines[i], pt);
    if (!best || r.d < best.d) best = { hole: i + 1, d: r.d, frac: r.frac };
  }
  return best && best.d <= offCourseM ? best : null;
}

export type FixResult =
  | { change: false; offCourse: true }
  | { change: boolean; offCourse?: false; hole: number; frac: number; d: number };

/**
 * Debouncer: advance only when the same new hole is seen on `confirmFixes`
 * consecutive fixes, and never move backwards (the manual buttons cover that).
 */
export function makeHoleTracker({ confirmFixes = 2 } = {}) {
  let last = { hole: 0, count: 0 };
  return function onFix(lines: LatLng[][], pt: LatLng, currentHole: number): FixResult {
    const hit = detectHole(lines, pt, currentHole);
    if (!hit) return { change: false, offCourse: true };
    last = hit.hole === last.hole ? { hole: hit.hole, count: last.count + 1 } : { hole: hit.hole, count: 1 };
    const change = last.count >= confirmFixes && hit.hole > currentHole;
    return { change, hole: change ? hit.hole : currentHole, frac: hit.hole === currentHole ? hit.frac : 0, d: hit.d };
  };
}
