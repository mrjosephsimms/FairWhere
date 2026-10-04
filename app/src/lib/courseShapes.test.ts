import { describe, expect, it } from "vitest";
import type { LineString } from "geojson";
import { arc, courseFeatures, smoothLine } from "./courseShapes";
import { playSequence, type LatLng } from "./courses";
import { course } from "./fixtures";

const seq = playSequence(course("redhawk"));

describe("smoothLine", () => {
  const dogleg: LatLng[] = [[33, -117], [33.002, -117], [33.002, -116.998]];
  it("keeps the tee and green exactly", () => {
    const s = smoothLine(dogleg);
    expect(s[0]).toEqual(dogleg[0]);
    expect(s[s.length - 1]).toEqual(dogleg[2]);
  });
  it("rounds the corner (more points, none on the sharp elbow)", () => {
    const s = smoothLine(dogleg);
    expect(s.length).toBeGreaterThan(dogleg.length);
    expect(s).not.toContainEqual(dogleg[1]);
  });
  it("leaves a straight two-point hole alone", () => {
    expect(smoothLine([[33, -117], [33.001, -117]])).toEqual([[33, -117], [33.001, -117]]);
  });
});

describe("arc", () => {
  it("runs from a to b and bows off the straight line", () => {
    const a: LatLng = [33, -117], b: LatLng = [33, -116.998];
    const pts = arc(a, b);
    expect(pts[0][0]).toBeCloseTo(a[0], 9);
    expect(pts[0][1]).toBeCloseTo(a[1], 9);
    expect(pts[pts.length - 1][0]).toBeCloseTo(b[0], 9);
    expect(pts[pts.length - 1][1]).toBeCloseTo(b[1], 9);
    expect(Math.abs(pts[Math.floor(pts.length / 2)][0] - 33)).toBeGreaterThan(1e-5);
  });
});

describe("courseFeatures", () => {
  const kinds = (fc: ReturnType<typeof courseFeatures>, kind: string) => fc.features.filter((f) => f.properties!.kind === kind);

  it("draws 18 holes and 17 green-to-tee links", () => {
    const fc = courseFeatures(seq, 5, false);
    expect(kinds(fc, "hole")).toHaveLength(18);
    expect(kinds(fc, "link")).toHaveLength(17);
    expect(kinds(fc, "tee")).toHaveLength(18);
  });

  it("marks played, current and upcoming holes, and the walk to the next tee", () => {
    const fc = courseFeatures(seq, 5, false);
    const state = (kind: string, n: number) => kinds(fc, kind).find((f) => f.properties!.n === n)!.properties!.state;
    expect(state("hole", 4)).toBe("past");
    expect(state("hole", 5)).toBe("now");
    expect(state("hole", 6)).toBe("next");
    expect(state("link", 6)).toBe("up"); // green 5 -> tee 6
    expect(state("link", 5)).toBe("now"); // led into the current hole
  });

  it("each link starts on a green and ends on the next tee", () => {
    const fc = courseFeatures(seq, 1, false);
    const link = kinds(fc, "link").find((f) => f.properties!.n === 2)!;
    const coords = (link.geometry as LineString).coordinates;
    const tee2 = seq[1].centerline[0];
    expect(coords[coords.length - 1][0]).toBeCloseTo(tee2[1], 9);
    expect(coords[coords.length - 1][1]).toBeCloseTo(tee2[0], 9);
  });

  it("a finished round is all played", () => {
    const fc = courseFeatures(seq, 0, true);
    expect(new Set(fc.features.map((f) => f.properties!.state))).toEqual(new Set(["past"]));
  });
});
