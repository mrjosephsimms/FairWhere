// "Play this hole": a little golf game on the real hole, so friends at home can try
// to beat the score someone just made out on the course. Pure + tested; the 3D show
// is game3d/.
//
// Works in a local flat frame in metres (x east, y north) around the hole's tee.
// With mapped features (OpenStreetMap: fairways, bunkers, water, woods, trees) the
// lies come from the real course; without them, from distance off the hole's line.
import type { CourseFeatures, LatLng, PlayHole } from "./courses";

export type XY = [number, number];
export type Lie = "tee" | "fairway" | "rough" | "trees" | "bunker" | "green";
export type Landing = Lie | "water" | "lost";

export interface Club {
  name: string;
  /** What it looks like in the golfer's hands. */
  kind: "driver" | "wood" | "iron" | "wedge" | "putter";
  /** Full-swing carry in metres. */
  carry: number;
}

/** Roughly an amateur bag (metres; 1 m ≈ 1.09 yd). */
export const CLUBS: Club[] = [
  { name: "Driver", kind: "driver", carry: 205 },
  { name: "3 wood", kind: "wood", carry: 185 },
  { name: "5 iron", kind: "iron", carry: 155 },
  { name: "7 iron", kind: "iron", carry: 135 },
  { name: "9 iron", kind: "iron", carry: 112 },
  { name: "Wedge", kind: "wedge", carry: 90 },
  { name: "Sand wedge", kind: "wedge", carry: 65 },
  { name: "Chip", kind: "wedge", carry: 35 },
];
export const PUTTER: Club = { name: "Putter", kind: "putter", carry: 25 };

/** Without mapped fairways: this close to the hole's line is fairway... */
export const FAIRWAY_M = 20;
/** ...this close is rough, beyond it is under the trees... */
export const ROUGH_M = 32;
/** ...and past this it's out of bounds. */
export const OB_M = 78;
/** Ball within this of the cup on a putt drops. */
const CUP_M = 0.9;
/** Pick it up after this many. */
export const MAX_STROKES = 10;
/** The direction tap's edges miss by this much (wide enough to find trouble). */
export const MAX_MISS_DEG = 24;

/** Distance / scatter multipliers by where the ball sits. */
const LIE_PLAY: Record<Lie, { dist: number; scatter: number }> = {
  tee: { dist: 1, scatter: 1 },
  fairway: { dist: 1, scatter: 1 },
  rough: { dist: 0.85, scatter: 1.4 },
  bunker: { dist: 0.75, scatter: 1.3 },
  trees: { dist: 0.55, scatter: 1.8 }, // punch it out
  green: { dist: 1, scatter: 1 },
};

export interface HoleFeatures {
  fairways: XY[][];
  bunkers: XY[][];
  water: XY[][];
  woods: XY[][];
  trees: XY[];
}

export interface Wind {
  /** Unit vector the wind blows toward (x east, y north). */
  dir: XY;
  mph: number;
}

export interface GameHole {
  n: number;
  par: number;
  line: XY[];
  green: XY;
  greenRadius: number;
  origin: LatLng;
  features: HoleFeatures;
  wind?: Wind;
}

/** Metres of drift per metre of carry per mph: a 10 mph wind moves a 200 m drive ~5 m. */
const WIND_DRIFT = 0.0025;

/** A steady breeze for each hole (same every time you play it), calm to ~12 mph. */
export function holeWind(n: number): Wind {
  const a = (n * 2.39996) % (Math.PI * 2); // golden-angle spread so neighbouring holes differ
  return { dir: [Math.cos(a), Math.sin(a)], mph: (n * 7) % 13 };
}

export interface Shot {
  from: XY;
  to: XY;
  club: string;
  result: Landing | "holed";
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

/** Ray-casting point-in-polygon. */
export function inside(poly: XY[], p: XY): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const inAny = (polys: XY[][], p: XY) => polys.some((poly) => inside(poly, p));

// ------------------------------------------------------------------ setup

const NO_FEATURES: HoleFeatures = { fairways: [], bunkers: [], water: [], woods: [], trees: [] };

/** The hole in the local frame, with the mapped features that sit near it. */
export function makeGameHole(h: PlayHole, course?: CourseFeatures | null): GameHole {
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
  // Keep what's within reach of this hole (anything near its line or green).
  const near = (p: XY, m: number) => project(line, p).off < m;
  const polys = (list: LatLng[][] | undefined, m: number) =>
    (list ?? []).map((pl) => pl.map((p) => toXY(origin, p))).filter((pl) => pl.some((p) => near(p, m)));
  const features: HoleFeatures = course
    ? {
        fairways: polys(course.fairways, 25),
        bunkers: polys(course.bunkers, 70),
        water: polys(course.water, 160),
        woods: polys(course.woods, 160),
        trees: (course.trees ?? []).map((p) => toXY(origin, p)).filter((p) => near(p, 160)),
      }
    : NO_FEATURES;
  return { n: h.n, par: h.par, line, green, greenRadius, origin, features, wind: holeWind(h.n) };
}

export const newGame = (hole: GameHole): GameState => ({ ball: hole.line[0], lie: "tee", strokes: 0, holed: false, shots: [] });

export const distanceToPin = (s: GameState, hole: GameHole) => dist(s.ball, hole.green);

/** Where the ball ended up. Order matters: green, water, sand, fairway, then by distance off the line. */
export function lieAt(p: XY, hole: GameHole): Landing {
  if (dist(p, hole.green) <= hole.greenRadius) return "green";
  const f = hole.features;
  if (inAny(f.water, p)) return "water";
  if (inAny(f.bunkers, p)) return "bunker";
  const { off } = project(hole.line, p);
  if (off > OB_M) return "lost";
  if (f.fairways.length ? inAny(f.fairways, p) : off <= FAIRWAY_M) return "fairway";
  if (inAny(f.woods, p) || f.trees.some((t) => dist(t, p) < 6)) return "trees";
  return off <= ROUGH_M ? "rough" : "trees";
}

// ------------------------------------------------------------------ playing

/** The club for this lie and distance: the shortest that gets there, the driver only off the tee. */
export function pickClub(s: GameState, hole: GameHole): Club {
  if (s.lie === "green") return PUTTER;
  const d = distanceToPin(s, hole);
  const bag = s.lie === "tee" ? CLUBS : CLUBS.slice(1);
  const fits = [...bag].reverse().find((c) => c.carry * LIE_PLAY[s.lie].dist >= d * 0.92);
  return fits ?? bag[0];
}

/**
 * Where a full swing is aimed: the flag once it's in reach, otherwise down the hole's
 * line (so doglegs bend), laying up short rather than into water or sand.
 */
export function aimPoint(s: GameState, hole: GameHole, club = pickClub(s, hole)): XY {
  const reach = club.carry * LIE_PLAY[s.lie].dist;
  if (club === PUTTER || distanceToPin(s, hole) <= reach * 1.05) return hole.green;
  const { along, length } = project(hole.line, s.ball);
  if (along + reach >= length - hole.greenRadius) return hole.green;
  for (const k of [1, 0.92, 0.84, 0.76, 0.68, 0.6]) {
    const p = pointAlong(hole.line, along + reach * k);
    const lie = lieAt(p, hole);
    if (lie !== "water" && lie !== "bunker") return p;
  }
  return pointAlong(hole.line, along + reach);
}

/**
 * One swing. `power` from the speed tap (1 = the planned distance, up to 1.1);
 * `aim` from the direction tap (0 = dead on line, ±1 = MAX_MISS_DEG off). The lie
 * takes distance off and adds scatter. `rng` adds a touch of real-life wobble.
 */
export function swing(s: GameState, hole: GameHole, power: number, aim: number, rng: () => number = Math.random): GameState {
  if (s.holed || s.lie === "green") return s;
  const club = pickClub(s, hole);
  const target = aimPoint(s, hole, club);
  const play = LIE_PLAY[s.lie];
  const planned = Math.min(dist(s.ball, target), club.carry * play.dist);
  const carry = planned * Math.min(Math.max(power, 0.05), 1.1) * (1 + (rng() - 0.5) * 0.06);
  const heading = Math.atan2(target[1] - s.ball[1], target[0] - s.ball[0]);
  const off = (aim * MAX_MISS_DEG + (rng() - 0.5) * 3) * play.scatter * (Math.PI / 180);
  const drift = hole.wind ? hole.wind.mph * WIND_DRIFT * carry : 0;
  const to: XY = [
    s.ball[0] + Math.cos(heading - off) * carry + (hole.wind?.dir[0] ?? 0) * drift,
    s.ball[1] + Math.sin(heading - off) * carry + (hole.wind?.dir[1] ?? 0) * drift,
  ];
  const landing = lieAt(to, hole);
  const shot: Shot = { from: s.ball, to, club: club.name, result: landing };
  if (landing === "lost") {
    // Stroke and distance: count the shot plus a penalty, play again from the same spot.
    return pickup({ ...s, strokes: s.strokes + 2, shots: [...s.shots, shot] });
  }
  if (landing === "water") {
    // Penalty drop where it went in (last dry point on the way there).
    return pickup({ ...s, ball: dropBeforeWater(s.ball, to, hole), lie: "rough", strokes: s.strokes + 2, shots: [...s.shots, shot] });
  }
  return pickup({ ...s, ball: to, lie: landing, strokes: s.strokes + 1, shots: [...s.shots, shot] });
}

/** Walk back along the shot from the splash until it's dry land again. */
export function dropBeforeWater(from: XY, to: XY, hole: GameHole): XY {
  for (let k = 0.97; k > 0; k -= 0.03) {
    const p: XY = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k];
    if (!inAny(hole.features.water, p)) return p;
  }
  return from;
}

/** Sweet spot on the speed meter (which runs 0 .. METER_MAX). */
export const SWEET: [number, number] = [0.92, 1.02];
export const METER_MAX = 1.1;
/** Dead-straight zone on the direction meter (which runs -1 .. 1). */
export const ON_LINE = 0.12;

/** Direction tap -> aim: inside the green zone is straight; the edges miss by MAX_MISS_DEG. */
export function tapDirection(stop: number): number {
  const a = Math.abs(stop);
  return a <= ON_LINE ? 0 : Math.sign(stop) * Math.min(1, (a - ON_LINE) / (1 - ON_LINE));
}

/** Speed tap -> power: the green zone is full; early comes up short; late flies long. */
export function tapPower(stop: number): number {
  if (stop >= SWEET[0] && stop <= SWEET[1]) return 1;
  return stop < SWEET[0] ? stop / SWEET[0] : Math.min(stop, METER_MAX);
}

/** How hard a perfect putt is on the meter (0..1) from here. */
export const puttTarget = (s: GameState, hole: GameHole) => Math.min(distanceToPin(s, hole) / PUTTER.carry, 1);

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
