import { describe, expect, it } from "vitest";
import { FAIRWAY_HALF_WIDTH_M, locateOnHole, makeSearchDetector, toYards } from "./onCourse";
import { playSequence, type LatLng } from "./courses";
import { alongLine } from "./geo";
import { course } from "./fixtures";

const seq = playSequence(course("redhawk"));
const hole = seq.find((h) => h.centerline.length >= 2 && h.par === 4)!;
const tee = hole.centerline[0];
const MIN = 60000;

/** Shift a point ~`m` metres east. */
const east = (p: LatLng, m: number): LatLng => [p[0], p[1] + m / (111320 * Math.cos((p[0] * Math.PI) / 180))];

describe("locateOnHole", () => {
  it("is at the start of the hole on the tee", () => {
    const pos = locateOnHole(hole, tee);
    expect(pos.fromTeeM).toBeCloseTo(0, 6);
    expect(pos.frac).toBeCloseTo(0, 6);
    expect(pos.offFairway).toBe(false);
    expect(pos.nearTeeOrGreen).toBe(true);
  });

  it("counts down to the green along the hole", () => {
    const mid = locateOnHole(hole, alongLine(hole.centerline, 0.5));
    const late = locateOnHole(hole, alongLine(hole.centerline, 0.8));
    expect(mid.frac).toBeCloseTo(0.5, 1);
    expect(late.toGreenM).toBeLessThan(mid.toGreenM);
    expect(mid.offFairway).toBe(false);
  });

  it("flags a spot well off the centerline as off the fairway", () => {
    const pos = locateOnHole(hole, east(alongLine(hole.centerline, 0.5), 45));
    expect(pos.lateralM).toBeGreaterThan(FAIRWAY_HALF_WIDTH_M);
    expect(pos.offFairway).toBe(true);
    expect(pos.nearTeeOrGreen).toBe(false);
  });

  it("converts metres to yards", () => {
    expect(toYards(100)).toBe(109);
  });
});

describe("makeSearchDetector", () => {
  const rough = { offFairway: true, nearTeeOrGreen: false };
  const spot = east(alongLine(hole.centerline, 0.5), 45);

  it("calls a ball hunt after 3 minutes in one spot in the rough", () => {
    const hunt = makeSearchDetector();
    expect(hunt(spot, 0, rough)).toBeNull();
    expect(hunt(east(spot, 5), 2 * MIN, rough)).toBeNull();
    expect(hunt(east(spot, -5), 3 * MIN, rough)).toBe(0);
    expect(hunt(spot, 5 * MIN, rough)).toBe(0); // still the same hunt
  });

  it("never fires on the fairway or around tees and greens", () => {
    const hunt = makeSearchDetector();
    for (const t of [0, 2, 4, 6]) expect(hunt(spot, t * MIN, { offFairway: false, nearTeeOrGreen: false })).toBeNull();
    for (const t of [0, 2, 4, 6]) expect(hunt(spot, t * MIN, { offFairway: true, nearTeeOrGreen: true })).toBeNull();
  });

  it("resets when the golfer moves on", () => {
    const hunt = makeSearchDetector();
    hunt(spot, 0, rough);
    expect(hunt(east(spot, 60), 4 * MIN, rough)).toBeNull(); // walked away: new anchor
    expect(hunt(east(spot, 60), 6 * MIN, rough)).toBeNull(); // only 2 min at the new spot
    expect(hunt(east(spot, 60), 7 * MIN, rough)).toBe(4 * MIN);
  });

  it("honours a longer threshold (riders park on the cart path)", () => {
    const hunt = makeSearchDetector({ minMs: 4 * MIN });
    hunt(spot, 0, rough);
    expect(hunt(spot, 3 * MIN, rough)).toBeNull();
    expect(hunt(spot, 4 * MIN, rough)).toBe(0);
  });
});
