import { describe, expect, it } from "vitest";
import { describeNote, isOff, NO_ALERTS, paceWords, summarizeWatch } from "./notify";
import type { Note } from "./db";

const note = (o: Partial<Note>): Note => ({
  id: "n", user_id: "me", golfer_id: "g", round_id: "r", kind: "hole", hole: 9, eta: "2026-10-04T19:10:00Z",
  delta_min: -2, strokes: null, created_at: "2026-10-04T18:40:00Z", read_at: null, ...o,
});

describe("paceWords", () => {
  it("matches the pace chip's thresholds", () => {
    expect(paceWords(4)).toBe("On pace");
    expect(paceWords(-12)).toBe("12 min ahead of pace");
    expect(paceWords(9)).toBe("9 min behind pace");
    expect(paceWords(null)).toBeNull();
  });
});

describe("describeNote", () => {
  it("hole update: hole, pace and finish", () => {
    const d = describeNote(note({}), "Mike");
    expect(d.title).toBe("Mike finished hole 9");
    expect(d.body).toMatch(/^On pace · done ~/);
  });
  it("about to finish: minutes out from when it was sent", () => {
    expect(describeNote(note({ kind: "soon" }), "Mike").title).toBe("Mike is about 30 min from done");
  });
  it("finished with a score, or early", () => {
    expect(describeNote(note({ kind: "finished", hole: 18, strokes: 87 }), "Mike")).toEqual({ title: "Mike finished", body: "Score: 87" });
    expect(describeNote(note({ kind: "finished", hole: 12 }), "Mike", "Redhawk").title).toBe("Mike finished after 12 holes");
  });
  it("teed off and ball hunt", () => {
    expect(describeNote(note({ kind: "tee_off" }), "Mike", "Redhawk Golf Club")).toEqual({ title: "Mike teed off", body: "Redhawk Golf Club" });
    expect(describeNote(note({ kind: "ball_hunt", hole: 4 }), "Mike").body).toBe("On hole 4");
  });
});

describe("summarizeWatch", () => {
  it("reads naturally", () => {
    expect(summarizeWatch({ ...NO_ALERTS, holes: [18, 9], before_finish_min: 30, finished: true })).toBe("holes 9 & 18 · 30 min before done · when done");
    expect(summarizeWatch({ ...NO_ALERTS, every_hole: true, holes: [9] })).toBe("every hole");
  });
  it("knows when everything is off", () => {
    expect(isOff(NO_ALERTS)).toBe(true);
    expect(isOff({ ...NO_ALERTS, tee_off: true })).toBe(false);
  });
});
