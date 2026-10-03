import { describe, expect, it } from "vitest";
import { allocate, DEFAULT_TARGET, estimate, paceChip, type PaceInput } from "./pace";
import { playSequence } from "./courses";
import { course } from "./fixtures";

const seq = playSequence(course("redhawk"));
const pars = seq.map((h) => h.par);
const yards = seq.map((h) => h.yards);
const MIN = 60000;
const now = Date.UTC(2026, 9, 3, 18, 0);
const base = (o: Partial<PaceInput>): PaceInput => ({ pars, teeTime: now - 150 * MIN, targetMinutes: 255, hole: 1, status: "live", ...o });

describe("allocate", () => {
  it("splits the target across holes by par weight", () => {
    const a = allocate(pars, 255);
    expect(a.reduce((s, x) => s + x, 0)).toBeCloseTo(255, 6);
    expect(a[0] / a[3]).toBeCloseTo(1.22 / 0.78, 6); // hole 1 par 5 vs hole 4 par 3
  });
});

describe("walking vs riding", () => {
  it("defaults walkers to a longer usual round", () => {
    expect(DEFAULT_TARGET.walking).toBeGreaterThan(DEFAULT_TARGET.riding);
  });

  it("riding ignores yardage; the split is the same as par-only", () => {
    expect(allocate(pars, 240, { mode: "riding", yards })).toEqual(allocate(pars, 240));
  });

  it("walking keeps the total but gives long holes more time than short ones of the same par", () => {
    const walk = allocate(pars, 270, { mode: "walking", yards });
    expect(walk.reduce((s, x) => s + x, 0)).toBeCloseTo(270, 6);
    const par4s = seq.map((h, i) => ({ y: h.yards, t: walk[i] })).filter((_, i) => pars[i] === 4 && yards[i]);
    const longest = par4s.reduce((a, b) => (b.y! > a.y! ? b : a));
    const shortest = par4s.reduce((a, b) => (b.y! < a.y! ? b : a));
    expect(longest.t).toBeGreaterThan(shortest.t);
  });

  it("walking falls back to par weight when yardage is unknown", () => {
    expect(allocate(pars, 270, { mode: "walking", yards: pars.map(() => null) })).toEqual(allocate(pars, 270));
  });

  it("a walker's full-round estimate is longer at the default pace", () => {
    const ride = estimate(base({ teeTime: now + MIN, targetMinutes: DEFAULT_TARGET.riding, mode: "riding" }), now);
    const walk = estimate(base({ teeTime: now + MIN, targetMinutes: DEFAULT_TARGET.walking, mode: "walking", yards }), now);
    expect((walk.eta - ride.eta) / MIN).toBe(DEFAULT_TARGET.walking - DEFAULT_TARGET.riding);
  });
});

describe("estimate", () => {
  it("matches the reference: hole 11, 2:30 elapsed, 4h15 pace", () => {
    const e = estimate(base({ hole: 11, holeStartedAt: now - 5 * MIN }), now);
    const left = Math.round((e.eta - now) / MIN);
    expect(e.phase).toBe("live");
    expect(left).toBe(108); // node reference/test.js prints the same
    expect(Math.round(e.deltaMin)).toBe(2);
  });

  it("is 'pre' before the tee time and projects a full round", () => {
    const e = estimate(base({ teeTime: now + MIN }), now);
    expect(e.phase).toBe("pre");
    expect(e.eta).toBe(now + MIN + 255 * MIN);
  });

  it("ignores pace for the first 20 minutes", () => {
    const e = estimate(base({ teeTime: now - 15 * MIN, holeStartedAt: now - 15 * MIN }), now);
    // pace factor 1 -> remaining = total - expected
    expect(e.eta).toBeGreaterThan(now + 230 * MIN);
  });

  it("clamps a very slow pace at 1.5x", () => {
    const slow = estimate(base({ teeTime: now - 200 * MIN, hole: 3, holeStartedAt: now }), now);
    const expectedUsed = allocate(pars, 255).slice(0, 2).reduce((s, x) => s + x, 0);
    expect((slow.eta - now) / MIN).toBeCloseTo((255 - expectedUsed) * 1.5, 6);
  });

  it("never assumes more than 90% of a hole from time alone", () => {
    const e = estimate(base({ hole: 2, holeStartedAt: now - 120 * MIN }), now);
    expect(e.frac).toBe(0.9);
  });

  it("prefers the GPS hole fraction when present", () => {
    const e = estimate(base({ hole: 5, holeStartedAt: now, holeFraction: 0.5 }), now);
    expect(e.frac).toBe(0.5);
  });

  it("reports actual finish once done", () => {
    const e = estimate(base({ status: "done", finishedAt: now - 10 * MIN, teeTime: now - 250 * MIN }), now);
    expect(e).toMatchObject({ phase: "done", eta: now - 10 * MIN });
    expect(Math.round(e.deltaMin)).toBe(-15);
  });
});

describe("paceChip", () => {
  const chip = (deltaMin: number) => paceChip({ phase: "live", eta: 0, deltaMin });
  it("labels and colors the delta", () => {
    expect(chip(4)).toEqual({ label: "On pace", tone: "good" });
    expect(chip(-5)).toEqual({ label: "On pace", tone: "good" });
    expect(chip(-12)).toEqual({ label: "12 min ahead", tone: "good" });
    expect(chip(9)).toEqual({ label: "9 min behind", tone: "warn" });
    expect(chip(16)).toEqual({ label: "16 min behind", tone: "bad" });
  });
});
