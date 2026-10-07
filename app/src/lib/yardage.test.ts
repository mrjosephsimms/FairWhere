import { describe, expect, it } from "vitest";
import { playSequence, type LatLng } from "./courses";
import { course, features } from "./fixtures";
import { distM } from "./holeDetect";
import { circle, defaultTarget, greenYards, hazardsAhead, layupRings, originFor, splitYards } from "./yardage";

const seq = playSequence(course("redhawk"));
const h1 = seq[0];
const tee = h1.centerline[0];
const green = h1.green?.center ?? h1.centerline[h1.centerline.length - 1];

describe("yardage", () => {
  it("measures from you on the hole, else from the tee", () => {
    const mid = h1.centerline[Math.floor(h1.centerline.length / 2)];
    expect(originFor(h1, mid)).toEqual({ pt: mid, fromYou: true });
    expect(originFor(h1, [33.6, -117.3]).fromYou).toBe(false);
    expect(originFor(h1, null).pt).toEqual(tee);
    expect(originFor(h1, green)).toEqual({ pt: green, fromYou: true }); // on the green: ~0, not the tee's distance
  });
  it("front <= middle <= back of the green", () => {
    const y = greenYards(tee, h1);
    expect(y.center).toBeGreaterThan(100);
    if (y.front != null && y.back != null) {
      expect(y.front).toBeLessThanOrEqual(y.center);
      expect(y.back).toBeGreaterThanOrEqual(y.center);
    }
  });
  it("the default target sits halfway and splits the distance", () => {
    const t = defaultTarget(tee, h1);
    const { toTarget, toGreen } = splitYards(tee, t, h1);
    expect(Math.abs(toTarget - toGreen)).toBeLessThan(25);
    expect(toTarget + toGreen).toBeGreaterThanOrEqual(greenYards(tee, h1).center);
  });
  it("hazards ahead have reach < carry, nearest first", () => {
    const hz = seq.flatMap((h) => hazardsAhead(h.centerline[0], h, features("redhawk")));
    expect(hz.length).toBeGreaterThan(0);
    for (const x of hz) expect(x.reach).toBeLessThanOrEqual(x.carry);
    const one = hazardsAhead(seq[1].centerline[0], seq[1], features("redhawk"));
    expect(one.map((x) => x.reach)).toEqual([...one.map((x) => x.reach)].sort((a, b) => a - b));
    expect(hazardsAhead(tee, h1, null)).toEqual([]);
  });
  it("layup rings fit the hole and sit the right distance from the green", () => {
    const par3 = seq.find((h) => h.par === 3)!;
    for (const h of [h1, par3]) {
      const len = distM(h.centerline[0], h.green?.center ?? h.centerline[h.centerline.length - 1]) * 1.09361;
      for (const r of layupRings(h)) {
        expect(r.yards).toBeLessThan(len);
        expect(Math.abs(distM(r.ring[0], h.green?.center ?? green) * 1.09361 - r.yards)).toBeLessThan(2);
      }
    }
  });
  it("circles are closed", () => {
    const c = circle([33.5, -117.1] as LatLng, 100);
    expect(c[0][0]).toBeCloseTo(c[c.length - 1][0], 9);
  });
});
