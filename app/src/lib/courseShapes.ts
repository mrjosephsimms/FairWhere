// Course drawing geometry: smooth, flowing hole paths and the green -> next-tee walk.
// Pure (tested); MapView styles the result.
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { LatLng, PlayHole } from "./courses";

export type HoleState = "past" | "now" | "next";

/**
 * Chaikin corner-cutting: rounds a polyline's corners into a smooth curve while
 * keeping both ends exactly where they were (tee and green stay put).
 */
export function smoothLine(pts: LatLng[], iterations = 3): LatLng[] {
  let line = pts;
  for (let k = 0; k < iterations && line.length > 2; k++) {
    const out: LatLng[] = [line[0]];
    for (let i = 0; i < line.length - 1; i++) {
      const [a, b] = [line[i], line[i + 1]];
      const q: LatLng = [0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]];
      const r: LatLng = [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]];
      if (i > 0) out.push(q);
      if (i < line.length - 2) out.push(r);
    }
    out.push(line[line.length - 1]);
    line = out;
  }
  return line;
}

/**
 * A gentle arc from `a` to `b` (quadratic Bézier bowed sideways by `bow` of the
 * distance), so the walk between holes reads as a path rather than a ruler line.
 */
export function arc(a: LatLng, b: LatLng, bow = 0.18, samples = 18): LatLng[] {
  const k = Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180); // work in a locally-square frame
  const ax = a[1] * k, ay = a[0], bx = b[1] * k, by = b[0];
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const cx = mx - (by - ay) * bow, cy = my + (bx - ax) * bow; // perpendicular offset
  return Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples, u = 1 - t;
    const x = u * u * ax + 2 * u * t * cx + t * t * bx, y = u * u * ay + 2 * u * t * cy + t * t * by;
    return [y, x / k] as LatLng;
  });
}

const holeState = (n: number, current: number, finished: boolean): HoleState =>
  finished || n < current ? "past" : n === current ? "now" : "next";

type Shape = Feature<LineString | Point, Record<string, string | number>>;

/**
 * Everything MapView draws for a course:
 *  - kind "hole": smoothed tee -> green path, with state past / now / next
 *  - kind "link": arc from each green to the next tee; state "up" for the walk
 *    the golfer is about to take, otherwise the state of the hole it leads to
 *  - kind "tee" / "green": points for the hole-number badge and the flag
 */
export function courseFeatures(seq: PlayHole[], current: number, finished: boolean): FeatureCollection<LineString | Point, Record<string, string | number>> {
  const lngLat = (p: LatLng) => [p[1], p[0]];
  const greenOf = (h: PlayHole) => h.green?.center ?? h.centerline[h.centerline.length - 1];
  const features: Shape[] = [];
  seq.forEach((h, i) => {
    const state = holeState(h.n, current, finished);
    const path = smoothLine(h.centerline);
    path[path.length - 1] = greenOf(h); // finish exactly on the flag
    features.push({ type: "Feature", properties: { kind: "hole", n: h.n, state }, geometry: { type: "LineString", coordinates: path.map(lngLat) } });
    features.push({ type: "Feature", properties: { kind: "tee", n: h.n, state }, geometry: { type: "Point", coordinates: lngLat(h.centerline[0]) } });
    features.push({ type: "Feature", properties: { kind: "green", n: h.n, state }, geometry: { type: "Point", coordinates: lngLat(greenOf(h)) } });
    const next = seq[i + 1];
    if (next) {
      const to = holeState(next.n, current, finished);
      const linkState = !finished && h.n === current ? "up" : to;
      features.push({ type: "Feature", properties: { kind: "link", n: next.n, state: linkState },
        geometry: { type: "LineString", coordinates: arc(greenOf(h), next.centerline[0]).map(lngLat) } });
    }
  });
  return { type: "FeatureCollection", features };
}
