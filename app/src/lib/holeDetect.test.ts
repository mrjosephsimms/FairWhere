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

  it("advances when the golfer reaches the next tee", () => {
    const track = makeHoleTracker();
    const tee8 = lines[7][0];
    expect(track(lines, tee8, 7).change).toBe(false);
    expect(track(lines, tee8, 7)).toMatchObject({ change: true, hole: 8 });
  });

  it("doesn't advance while putting out next to the following tee", () => {
    const track = makeHoleTracker();
    const green7 = lines[6][lines[6].length - 1];
    for (let i = 0; i < 4; i++) expect(track(lines, green7, 7).change).toBe(false);
  });

  it("doesn't jump ahead from somewhere merely near a later hole (e.g. a house by the course)", () => {
    const track = makeHoleTracker();
    const mid8 = lines[7][Math.floor(lines[7].length / 2)];
    const nearby: LatLng = [mid8[0] + 80 / 111320, mid8[1]]; // ~80 m off hole 8's line
    for (let i = 0; i < 4; i++) expect(track(lines, nearby, 6).change).toBe(false);
  });

  it("with a tee right beside the green, putting out doesn't count but walking onto the tee does", () => {
    const m = 1 / 111320; // ~1 m of latitude
    const green: LatLng = [33.5, -117.1];
    const tight: LatLng[][] = [
      [[33.5 - 350 * m, -117.1], green], // hole 1 finishes at `green`
      [[33.5 + 20 * m, -117.1], [33.5 + 380 * m, -117.1]], // hole 2 tees off 20 m away
    ];
    const track = makeHoleTracker();
    for (let i = 0; i < 4; i++) expect(track(tight, green, 1).change).toBe(false);
    track(tight, tight[1][0], 1);
    expect(track(tight, tight[1][0], 1)).toMatchObject({ change: true, hole: 2 });
  });
});

