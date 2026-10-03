// "Play this hole": a tiny golf game on the real hole geometry, so friends at home
// can try to beat the score someone just made out on the course. Pure + tested;
// the screen is screens/PlayHole.tsx.
//
// Works in a local flat frame in metres (x east, y north) around the hole's tee.
import type { LatLng, PlayHole } from "./courses";
import { FAIRWAY_HALF_WIDTH_M } from "./onCourse";

export type XY = [number, number];
export type Lie = "tee" | "fairway" | "rough" | "green";

export interface Club {
  name: string;
  /** Full-swing carry in metres. */
  carry: number;
}

/** Roughly an amateur bag (metres; 1 m ≈ 1.09 yd). */
export const CLUBS: Club[] = [
  { name: "Driver", carry: 205 },
  { name: "3 wood", carry: 185 },
  { name: "5 iron", carry: 155 },
  { name: "7 iron", carry: 135 },
  { name: "9 iron", carry: 112 },
  { name: "Wedge", carry: 90 },
  { name: "Sand wedge", carry: 65 },
  { name: "Chip", carry: 35 },
];
export const PUTTER: Club = { name: "Putter", carry: 25 };

/** Further than this off the hole's line is out of bounds / lost. */
export const LOST_M = 60;
/** Ball within this of the cup on a putt drops. */
const CUP_M = 0.9;
/** Pick it up after this many. */
export const MAX_STROKES = 10;

export interface GameHole {
  n: number;
  par: number;
  line: XY[];
  green: XY;
  greenRadius: number;
  origin: LatLng;
}

export interface Shot {
  from: XY;
  to: XY;
  club: string;
  result: Lie | "lost" | "holed";
}

export interface GameState {
  ball: XY;
  lie: Lie;
  strokes: number;
  holed: boolean;
  shots: Shot[];
}

// ------------------------------------------------------------------ geometry

const M_PER_DEG = 111320;

export function toXY(origin: LatLng, p: LatLng): XY {
  const k = Math.cos((origin[0] * Math.PI) / 180);
  return [(p[1] - origin[1]) * M_PER_DEG * k, (p[0] - origin[0]) * M_PER_DEG];
}

export function toLatLng(origin: LatLng, p: XY): LatLng {
  const k = Math.cos((origin[0] * Math.PI) / 180);
  return [origin[0] + p[1] / M_PER_DEG, origin[1] + p[0] / (M_PER_DEG * k)];
}

const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Closest point on the polyline: distance off it and distance along it (metres). */
function project(line: XY[], p: XY): { off: number; along: number; length: number } {
  let best = { off: Infinity, along: 0 }, run = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], seg = dist(a, b) || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (seg * seg)));
    const q: XY = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const off = dist(p, q);
    if (off < best.off) best = { off, along: run + seg * t };
    run += seg;
  }
  return { ...best, length: run };
}

function pointAlong(line: XY[], s: number): XY {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], seg = dist(a, b);
    if (s <= seg) return [a[0] + ((b[0] - a[0]) * s) / seg, a[1] + ((b[1] - a[1]) * s) / seg];
    s -= seg;
  }
  return line[line.length - 1];
}

// ------------------------------------------------------------------ setup

export function makeGameHole(h: PlayHole): GameHole {
  const origin = h.centerline[0];
  const green = toXY(origin, h.green?.center ?? h.centerline[h.centerline.length - 1]);
  const line = h.centerline.map((p) => toXY(origin, p));
  line[line.length - 1] = green;
  let greenRadius = 14;
  const poly = h.green?.polygon;
  if (poly && poly.length >= 3) {
    const xy = poly.map((p) => toXY(origin, p));
    const area = Math.abs(xy.reduce((s, p, i) => s + p[0] * xy[(i + 1) % xy.length][1] - xy[(i + 1) % xy.length][0] * p[1], 0)) / 2;
    greenRadius = Math.min(Math.max(Math.sqrt(area / Math.PI), 8), 22);
  }
  return { n: h.n, par: h.par, line, green, greenRadius, origin };
}

export const newGame = (hole: GameHole): GameState => ({ ball: hole.line[0], lie: "tee", strokes: 0, holed: false, shots: [] });

export const distanceToPin = (s: GameState, hole: GameHole) => dist(s.ball, hole.green);

// ------------------------------------------------------------------ playing

/** The club for this lie and distance: the shortest that gets there, the driver only off the tee. */
export function pickClub(s: GameState, hole: GameHole): Club {
  if (s.lie === "green") return PUTTER;
  const d = distanceToPin(s, hole);
  const bag = s.lie === "tee" ? CLUBS : CLUBS.slice(1);
  const fits = [...bag].reverse().find((c) => c.carry >= d * 0.92);
  return fits ?? bag[0];
}

/** Where a full swing is aimed: down the hole's line (so doglegs bend), or at the flag once it's in reach. */
export function aimPoint(s: GameState, hole: GameHole, club = pickClub(s, hole)): XY {
  if (club === PUTTER || distanceToPin(s, hole) <= club.carry * 1.05) return hole.green;
  const { along, length } = project(hole.line, s.ball);
  const target = along + club.carry;
  return target >= length - hole.greenRadius ? hole.green : pointAlong(hole.line, target);
}

/** Where the ball ended up on the hole. */
export function lieAt(p: XY, hole: GameHole): Lie | "lost" {
  if (dist(p, hole.green) <= hole.greenRadius) return "green";
  const { off } = project(hole.line, p);
  return off <= FAIRWAY_HALF_WIDTH_M ? "fairway" : off <= LOST_M ? "rough" : "lost";
}

/**
 * A full swing (or chip). `power` from the meter: 1 = the full planned distance
 * (up to 1.1 for an over-swing). `aim` from the second tap: 0 = dead straight,
 * ±1 = the edges (about ±18° off line, enough to lose a drive; worse from the rough).
 * `rng` adds a touch of real-life scatter; inject a fixed one in tests.
 */
export function swing(s: GameState, hole: GameHole, power: number, aim: number, rng: () => number = Math.random): GameState {
  if (s.holed || s.lie === "green") return s;
  const club = pickClub(s, hole);
  const target = aimPoint(s, hole, club);
  const rough = s.lie === "rough";
  const planned = Math.min(dist(s.ball, target), club.carry);
  const carry = planned * Math.min(Math.max(power, 0.05), 1.1) * (rough ? 0.85 : 1) * (1 + (rng() - 0.5) * 0.06);
  const heading = Math.atan2(target[1] - s.ball[1], target[0] - s.ball[0]);
  const off = (aim * 18 + (rng() - 0.5) * 2) * (rough ? 1.5 : 1) * (Math.PI / 180);
  const to: XY = [s.ball[0] + Math.cos(heading - off) * carry, s.ball[1] + Math.sin(heading - off) * carry];
  const lie = lieAt(to, hole);
  if (lie === "lost") {
    // Stroke and distance: count the shot plus a penalty, play again from the same spot.
    return pickup({ ...s, strokes: s.strokes + 2, shots: [...s.shots, { from: s.ball, to, club: club.name, result: "lost" }] });
  }
  return pickup({ ...s, ball: to, lie, strokes: s.strokes + 1, shots: [...s.shots, { from: s.ball, to, club: club.name, result: lie }] });
}

/** How hard a perfect putt is on the meter (0..1) from here. */
export const puttTarget = (s: GameState, hole: GameHole) => Math.min(distanceToPin(s, hole) / PUTTER.carry, 1);

/** Sweet spot on the one-tap meter (which runs 0 .. METER_MAX). */
export const SWEET: [number, number] = [0.92, 1.02];
export const METER_MAX = 1.1;

/**
 * One tap = one swing. Where the marker stops sets both distance and direction:
 * in the sweet spot is full and straight; early comes up short and pulls a little;
 * late is an over-swing that slices hard (that's how drives get lost).
 */
export function tapToSwing(stop: number): { power: number; aim: number } {
  if (stop >= SWEET[0] && stop <= SWEET[1]) return { power: 1, aim: 0 };
  if (stop < SWEET[0]) return { power: stop / SWEET[0], aim: -Math.min(1, (SWEET[0] - stop) * 1.6) };
  return { power: Math.min(stop, METER_MAX), aim: Math.min(1, (stop - SWEET[1]) / (METER_MAX - SWEET[1])) };
}

/** A putt: `power` from the meter; the closer to puttTarget(), the closer it finishes. */
export function putt(s: GameState, hole: GameHole, power: number): GameState {
  if (s.holed || s.lie !== "green") return s;
  const d = distanceToPin(s, hole);
  const miss = Math.abs(power - puttTarget(s, hole)) * PUTTER.carry;
  const holed = miss < CUP_M || d < CUP_M;
  // Leave it short or long along the same line, `miss` metres from the cup.
  const k = holed ? 0 : (power < puttTarget(s, hole) ? 1 : -1) * (miss / d);
  const to: XY = holed ? hole.green : [hole.green[0] + (s.ball[0] - hole.green[0]) * k, hole.green[1] + (s.ball[1] - hole.green[1]) * k];
  return pickup({ ...s, ball: to, strokes: s.strokes + 1, holed, shots: [...s.shots, { from: s.ball, to, club: PUTTER.name, result: holed ? "holed" : "green" }] });
}

/** Out of strokes: count it as the maximum and end the hole. */
function pickup(s: GameState): GameState {
  return s.strokes >= MAX_STROKES && !s.holed ? { ...s, strokes: MAX_STROKES, holed: true } : s;
}
