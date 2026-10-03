import { describe, expect, it } from "vitest";
import { detectHole, distM, makeHoleTracker, nearestOnLine } from "./holeDetect";
import { playSequence, type LatLng } from "./courses";
import { course } from "./fixtures";

const lines = playSequence(course("redhawk")).map((h) => h.centerline);
const mid7 = lines[6][1];

describe("distM", () => {
  it("is ~111 km per degree of latitude", () => {
    expect(distM([33, -117], [34, -117])).toBeCloseTo(111195, -2);
  });
});

describe("nearestOnLine", () => {
  it("gives fraction 0 at the tee and 1 at the green", () => {
    const l = lines[0];
    expect(nearestOnLine(l, l[0]).frac).toBeCloseTo(0, 6);
    expect(nearestOnLine(l, l[l.length - 1]).frac).toBeCloseTo(1, 6);
  });
});

describe("detectHole", () => {
  it("detects hole 7 from its centerline when on 6 or 7", () => {
    expect(detectHole(lines, mid7, 6)?.hole).toBe(7);
    expect(detectHole(lines, mid7, 7)?.hole).toBe(7);
  });

  it("returns null off course", () => {
    expect(detectHole(lines, [33.5, -117.15], 7)).toBeNull();
  });

  it("only considers current-2..current+2", () => {
    // Hole 7's midpoint while 'on' hole 1 is outside the window.
    const hit = detectHole(lines, mid7, 1, 5000);
    expect(hit && hit.hole).toBeLessThanOrEqual(3);
  });
});

describe("makeHoleTracker", () => {
  it("needs 2 consecutive fixes to advance", () => {
    const track = makeHoleTracker();
    expect(track(lines, mid7, 6).change).toBe(false);
    expect(track(lines, mid7, 6)).toMatchObject({ change: true, hole: 7 });
  });

  it("never moves backwards automatically", () => {
    const track = makeHoleTracker();
    const mid5: LatLng = lines[4][1];
    track(lines, mid5, 6);
    expect(track(lines, mid5, 6)).toMatchObject({ change: false, hole: 6 });
  });

  it("reports off course without changing", () => {
    expect(makeHoleTracker()(lines, [33.5, -117.15], 7)).toEqual({ change: false, offCourse: true });
  });
});
