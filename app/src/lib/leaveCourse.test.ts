import { describe, expect, it } from "vitest";
import { makeLeaveDetector, metresFromCourse } from "./leaveCourse";
import { course } from "./fixtures";

const MIN = 60000;
const redhawk = course("redhawk");

describe("metresFromCourse", () => {
  it("is ~0 on a tee and kilometres away from town", () => {
    expect(metresFromCourse(redhawk, redhawk.holes[0].centerline[0])).toBeLessThan(1);
    expect(metresFromCourse(redhawk, [33.6, -117.2])).toBeGreaterThan(10000);
  });
});

describe("makeLeaveDetector", () => {
  it("never ends a round shared from home before they've reached the course", () => {
    const left = makeLeaveDetector();
    for (let i = 0; i < 30; i++) expect(left(15000, i * MIN)).toBe(false);
  });

  it("ends it after 10 minutes off the course once they've played", () => {
    const left = makeLeaveDetector();
    left(20, 0); // on the course
    expect(left(600, 1 * MIN)).toBe(false); // car park / clubhouse wander
    expect(left(600, 10 * MIN)).toBe(false);
    expect(left(600, 11 * MIN)).toBe(true);
  });

  it("a walk back onto the course resets the clock", () => {
    const left = makeLeaveDetector();
    left(20, 0);
    left(600, 1 * MIN);
    left(100, 8 * MIN); // back on the course
    expect(left(600, 9 * MIN)).toBe(false);
    expect(left(600, 18 * MIN)).toBe(false);
    expect(left(600, 19 * MIN)).toBe(true);
  });

  it("driving away ends it after two far fixes", () => {
    const left = makeLeaveDetector({}, true); // seeded: their last fix was on the course
    expect(left(5000, 0)).toBe(false);
    expect(left(6000, 30000)).toBe(true);
  });
});
