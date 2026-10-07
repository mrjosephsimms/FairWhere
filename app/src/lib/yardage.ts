// Map tools on the hole being played: live yardage to the green, a draggable measuring
// target, hazard reach/carry and layup rings. Pure geometry; drawn by components/MapView.
import type { CourseFeatures, LatLng, PlayHole } from "./courses";
import { distM, nearestOnLine } from "./holeDetect";
import { alongLine } from "./geo";
import { toYards } from "./onCourse";

export interface MapTools {
  yardage: boolean;
  measure: boolean;
  hazards: boolean;
  rings: boolean;
}
export const DEFAULT_TOOLS: MapTools = { yardage: true, measure: false, hazards: false, rings: false };

/** Further than this off the hole, GPS yardage is meaningless: measure from the tee instead. */
const ON_HOLE_M = 70;
/** Hazards within this of the centerline count as "in play". */
const IN_PLAY_M = 45;
const MAX_HAZARDS = 4;
/** Greenside bunkers: the green's front / back numbers already cover them. */
const GREENSIDE_M = 32;
/** Hazards closer together than this show as one (e.g. a cluster of fairway bunkers). */
const MERGE_M = 35;
export const RING_YARDS = [100, 150, 200];

const green = (h: PlayHole): LatLng => h.green?.center ?? h.centerline[h.centerline.length - 1];
const centroid = (ring: LatLng[]): LatLng => [
  ring.reduce((s, p) => s + p[0], 0) / ring.length,
  ring.reduce((s, p) => s + p[1], 0) / ring.length,
];

/** Where yardages are measured from: you (if you're on this hole) or the tee. */
export function originFor(h: PlayHole, gps: LatLng | null): { pt: LatLng; fromYou: boolean } {
  if (gps && nearestOnLine(h.centerline, gps).d <= ON_HOLE_M) return { pt: gps, fromYou: true };
  return { pt: h.centerline[0], fromYou: false };
}

/** Yards to the front, middle and back of the green (front/back from its outline, when mapped). */
export function greenYards(from: LatLng, h: PlayHole): { front: number | null; center: number; back: number | null } {
  const center = toYards(distM(from, green(h)));
  const poly = h.green?.polygon;
  if (!poly || poly.length < 3) return { front: null, center, back: null };
  const ds = poly.map((p) => distM(from, p));
  return { front: toYards(Math.min(...ds)), center, back: toYards(Math.max(...ds)) };
}

export interface Hazard {
  kind: "bunker" | "water";
  at: LatLng;
  /** Yards to the near edge, and to clear it. */
  reach: number;
  carry: number;
}

/** Bunkers and water in play ahead of you on this hole, nearest first. */
export function hazardsAhead(from: LatLng, h: PlayHole, f: CourseFeatures | null): Hazard[] {
  if (!f) return [];
  const fromFrac = nearestOnLine(h.centerline, from).frac;
  const out: Hazard[] = [];
  const consider = (kind: Hazard["kind"], ring: LatLng[]) => {
    if (ring.length < 3) return;
    const at = centroid(ring);
    const near = Math.min(...ring.map((p) => nearestOnLine(h.centerline, p).d));
    const along = nearestOnLine(h.centerline, at).frac;
    if (near > IN_PLAY_M || along < fromFrac || distM(at, green(h)) < GREENSIDE_M) return;
    const ds = ring.map((p) => distM(from, p));
    const hz: Hazard = { kind, at, reach: toYards(Math.min(...ds)), carry: toYards(Math.max(...ds)) };
    const twin = out.find((o) => o.kind === kind && distM(o.at, at) < MERGE_M);
    if (twin) (twin.reach = Math.min(twin.reach, hz.reach), twin.carry = Math.max(twin.carry, hz.carry));
    else out.push(hz);
  };
  f.water.forEach((r) => consider("water", r));
  f.bunkers.forEach((r) => consider("bunker", r));
  return out.sort((a, b) => a.reach - b.reach).slice(0, MAX_HAZARDS);
}

/** Where the measuring target starts: halfway from you (or the tee) to the green, on the hole's line. */
export function defaultTarget(from: LatLng, h: PlayHole): LatLng {
  const f = nearestOnLine(h.centerline, from).frac;
  return alongLine(h.centerline, f + (1 - f) / 2);
}

/** Yards from you to the target, and from the target to the green. */
export function splitYards(from: LatLng, target: LatLng, h: PlayHole): { toTarget: number; toGreen: number } {
  return { toTarget: toYards(distM(from, target)), toGreen: toYards(distM(target, green(h))) };
}

/** A circle as a closed [lat, lng] ring. */
export function circle(center: LatLng, radiusM: number, steps = 72): LatLng[] {
  const k = Math.cos((center[0] * Math.PI) / 180), dLat = radiusM / 111320;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return [center[0] + dLat * Math.sin(a), center[1] + (dLat * Math.cos(a)) / k] as LatLng;
  });
}

/** Layup rings around the green that fit on this hole, each labelled where it crosses the hole. */
export function layupRings(h: PlayHole): { yards: number; ring: LatLng[]; label: LatLng }[] {
  const g = green(h), len = distM(h.centerline[0], g);
  return RING_YARDS.filter((y) => y / 1.09361 < len - 15).map((yards) => {
    const r = yards / 1.09361;
    // Label: where the ring crosses the hole, swung ~35° off the line so it doesn't sit on you / the target.
    let cross = h.centerline[0];
    for (let i = 200; i >= 0; i--) {
      const p = alongLine(h.centerline, i / 200);
      if (distM(p, g) >= r) { cross = p; break; }
    }
    const k = Math.cos((g[0] * Math.PI) / 180);
    const ang = Math.atan2(cross[0] - g[0], (cross[1] - g[1]) * k) + (35 * Math.PI) / 180;
    const dLat = r / 111320;
    const label: LatLng = [g[0] + dLat * Math.sin(ang), g[1] + (dLat * Math.cos(ang)) / k];
    return { yards, ring: circle(g, r), label };
  });
}
