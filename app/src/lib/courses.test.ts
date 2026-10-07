import { describe, expect, it } from "vitest";
import { courseLabel, playSequence } from "./courses";
import { course, courses } from "./fixtures";

describe("playSequence", () => {
  it("plays Redhawk 1-18", () => {
    const seq = playSequence(course("redhawk"));
    expect(seq.map((h) => h.n)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(seq.map((h) => h.ref)).toEqual(seq.map((h) => String(h.n)));
  });

  it("plays Temecula Creek front nine then back nine as 1-18", () => {
    const seq = playSequence(course("temecula-creek-inn"), ["Oaks", "Creek"]);
    expect(seq[0].ref).toBe("Oaks 1");
    expect(seq[8].ref).toBe("Oaks 9");
    expect(seq[9]).toMatchObject({ ref: "Creek 1", n: 10 });
    expect(seq[17]).toMatchObject({ ref: "Creek 9", n: 18 });
  });

  it("rejects missing or repeated nines", () => {
    const tci = course("temecula-creek-inn");
    expect(() => playSequence(tci)).toThrow(/two different nines/);
    expect(() => playSequence(tci, ["Creek", "Creek"])).toThrow(/two different nines/);
    expect(() => playSequence(tci, ["Creek", "Back"])).toThrow(/two different nines/);
  });

  it("every course in data/courses.json has a centerline and a par for every hole", () => {
    for (const c of courses) {
      for (const h of c.holes) {
        expect(h.centerline.length, `${c.id} ${h.ref}`).toBeGreaterThanOrEqual(2);
        expect([3, 4, 5, 6], `${c.id} ${h.ref}`).toContain(h.par);
        expect(Number.isInteger(h.number), `${c.id} ${h.ref}`).toBe(true);
      }
    }
  });

  it("every course in data/courses.json plays as 18 holes (every pair of nines on 27/36-hole courses)", () => {
    const ids = new Set<string>();
    expect(courses.length).toBeGreaterThanOrEqual(2);
    for (const c of courses) {
      expect(ids.has(c.id), `duplicate id ${c.id}`).toBe(false);
      ids.add(c.id);
      const orders = c.nines
        ? c.nines.flatMap((a) => c.nines!.filter((b) => b !== a).map((b) => [a, b]))
        : [null];
      if (c.nines) {
        expect(c.nines.length, c.id).toBeGreaterThanOrEqual(2);
        for (const n of c.nines) {
          expect(c.holes.filter((h) => h.nine === n).map((h) => h.number).sort((x, y) => x - y), `${c.id} ${n}`)
            .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        }
        expect(c.holes.every((h) => h.nine && c.nines!.includes(h.nine)), c.id).toBe(true);
      } else {
        expect(c.holes.map((h) => h.number).sort((x, y) => x - y), c.id).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
      }
      for (const order of orders) {
        const seq = playSequence(c, order);
        expect(seq.map((h) => h.n), `${c.id} ${order}`).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
      }
    }
  });
});

describe("courseLabel", () => {
  it("adds the nines for 27-hole courses", () => {
    expect(courseLabel({ name: "Temecula Creek Inn" }, ["Oaks", "Creek"])).toBe("Temecula Creek Inn · Oaks / Creek");
    expect(courseLabel({ name: "Redhawk Golf Club" })).toBe("Redhawk Golf Club");
  });
});
