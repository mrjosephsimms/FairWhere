import { describe, expect, it } from "vitest";
import { alongLine, bearingDeg, courseBounds, FIX_FRESH_MS, roundPosition } from "./geo";
import { playSequence } from "./courses";
import { course } from "./fixtures";
import type { Round } from "./db";
import type { PaceEstimate } from "./pace";

const seq = playSequence(course("redhawk"));
const NOW = Date.parse("2026-10-03T17:00:00Z");
const round = (over: Partial<Round> = {}): Round => ({
  id: "r", user_id: "u", course_id: "redhawk", nines: null,
  tee_time: "2026-10-03T15:00:00Z", target_minutes: 255,
  hole: 7, hole_started_at: "2026-10-03T16:50:00Z", hole_fraction: null,
  last_lat: null, last_lng: null, last_fix_at: null,
  status: "live", visibility: "friends", mode: "riding", searching_since: null, finished_at: null, updated_at: "2026-10-03T16:50:00Z",
  ...over,
});
const live: PaceEstimate = { phase: "live", eta: NOW, deltaMin: 0, frac: 0.5 };

describe("alongLine", () => {
  const line: [number, number][] = [[33, -117], [33.001, -117], [33.002, -117]];
  it("returns the ends at 0 and 1", () => {
    expect(alongLine(line, 0)).toEqual([33, -117]);
    expect(alongLine(line, 1)).toEqual([33.002, -117]);
  });
  it("interpolates by distance", () => {
    const [lat] = alongLine(line, 0.25);
    expect(lat).toBeCloseTo(33.0005, 6);
  });
  it("clamps out-of-range fractions", () => {
    expect(alongLine(line, 2)).toEqual([33.002, -117]);
  });
});

describe("roundPosition", () => {
  it("uses a fresh GPS fix", () => {
    const r = round({ last_lat: 33.5, last_lng: -117.1, last_fix_at: new Date(NOW - 60000).toISOString() });
    expect(roundPosition(r, seq, live, NOW)).toEqual([33.5, -117.1]);
  });
  it("falls back to the pace guess along the current hole when the fix is stale", () => {
    const r = round({ last_lat: 33.5, last_lng: -117.1, last_fix_at: new Date(NOW - FIX_FRESH_MS - 1).toISOString() });
    expect(roundPosition(r, seq, live, NOW)).toEqual(alongLine(seq[6].centerline, 0.5));
  });
  it("puts a golfer who hasn't teed off on the first tee", () => {
    expect(roundPosition(round(), seq, { phase: "pre", eta: NOW, deltaMin: 0 }, NOW)).toEqual(seq[0].centerline[0]);
  });
  it("shows nobody once the round is over", () => {
    expect(roundPosition(round({ status: "done" }), seq, { phase: "done", eta: NOW, deltaMin: 0 }, NOW)).toBeNull();
  });
});

describe("courseBounds", () => {
  it("contains every hole", () => {
    const [[w, s], [e, n]] = courseBounds(seq);
    for (const [lat, lng] of seq.flatMap((h) => h.centerline)) {
      expect(lat).toBeGreaterThanOrEqual(s);
      expect(lat).toBeLessThanOrEqual(n);
      expect(lng).toBeGreaterThanOrEqual(w);
      expect(lng).toBeLessThanOrEqual(e);
    }
  });
});

describe("bearingDeg", () => {
  it("points the compass way", () => {
    expect(bearingDeg([33.5, -117.1], [33.6, -117.1])).toBeCloseTo(0, 5);
    expect(bearingDeg([33.5, -117.1], [33.5, -117.0])).toBeCloseTo(90, 5);
    expect(bearingDeg([33.5, -117.1], [33.4, -117.1])).toBeCloseTo(180, 5);
    expect(bearingDeg([33.5, -117.1], [33.5, -117.2])).toBeCloseTo(270, 5);
  });
});
