import { describe, expect, it } from "vitest";
import { fmtToPar, holeResult, summarize } from "./score";

const pars = [5, 4, 4, 3, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];

describe("summarize", () => {
  it("totals only the holes scored so far", () => {
    expect(summarize(new Map([[1, 6], [2, 4], [3, 5]]), pars)).toEqual({ strokes: 15, toPar: 2, thru: 3 });
  });
  it("is level with nothing entered", () => {
    expect(summarize(new Map(), pars)).toEqual({ strokes: 0, toPar: 0, thru: 0 });
  });
  it("handles holes entered out of order", () => {
    expect(summarize(new Map([[18, 4], [1, 4]]), pars)).toEqual({ strokes: 8, toPar: -2, thru: 2 });
  });
});

describe("fmtToPar", () => {
  it("formats like a leaderboard", () => {
    expect(fmtToPar(0)).toBe("E");
    expect(fmtToPar(3)).toBe("+3");
    expect(fmtToPar(-2)).toBe("−2");
  });
});

describe("holeResult", () => {
  it("names the result", () => {
    expect(holeResult(3, 5)).toBe("eagle");
    expect(holeResult(3, 4)).toBe("birdie");
    expect(holeResult(4, 4)).toBe("par");
    expect(holeResult(5, 4)).toBe("bogey");
    expect(holeResult(7, 4)).toBe("double");
  });
});
