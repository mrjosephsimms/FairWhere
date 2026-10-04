import { describe, expect, it } from "vitest";
import { profileStats } from "./stats";
import type { GamePlay, Round } from "./db";

const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5]; // par 72
const round = (id: string, over: Partial<Round>): Round => ({
  id, user_id: "me", course_id: "redhawk", nines: null, tee_time: "2026-10-01T15:00:00Z", target_minutes: 255,
  hole: 18, hole_started_at: "2026-10-01T15:00:00Z", hole_fraction: null, last_lat: null, last_lng: null, last_fix_at: null,
  status: "done", visibility: "friends", mode: "riding", searching_since: null, finished_at: "2026-10-01T19:00:00Z",
  updated_at: "2026-10-01T19:00:00Z", ...over,
});
const card = (strokes: number[]) => new Map(strokes.map((s, i) => [i + 1, s] as [number, number]));
const play = (strokes: number, to_beat: number | null): GamePlay =>
  ({ id: String(Math.random()), round_id: "x", hole: 1, player_id: "me", strokes, to_beat, created_at: "" });

describe("profileStats", () => {
  const rounds = [
    round("a", {}), // 4h, full card +4
    round("b", { course_id: "temecula-creek-inn", finished_at: "2026-10-01T18:30:00Z" }), // 3h30, full card +1
    round("c", { hole: 9, finished_at: "2026-10-01T17:00:00Z" }), // stopped after 9: 2h
    round("d", { status: "cancelled" }), // stopped sharing: never counts
  ];
  const scores = new Map([
    ["a", card(pars.map((p, i) => (i < 4 ? p + 1 : p)))],
    ["b", card(pars.map((p, i) => (i === 0 ? p - 1 : i < 3 ? p + 1 : p)))],
    ["c", card([5, 4, 2])],
  ]);
  const s = profileStats(rounds, scores, () => pars, [play(3, 4), play(5, 4), play(4, null)]);

  it("counts finished rounds and holes, and the favourite course", () => {
    expect(s.rounds).toBe(3);
    expect(s.holes).toBe(18 + 18 + 9);
    expect(s.favoriteCourse).toBe("redhawk");
  });

  it("scores only complete cards for average and best", () => {
    expect(s.avgScore).toBe(74.5);
    expect(s.bestRound).toMatchObject({ roundId: "b", strokes: 73, toPar: 1 });
  });

  it("counts birdies (or better) and pars across every scored hole", () => {
    // a: 14 pars; b: 1 birdie + 15 pars; c: hole 2 par, hole 3 birdie
    expect(s.birdies).toBe(2);
    expect(s.pars).toBe(14 + 15 + 1);
  });

  it("times full rounds for pace, all rounds for hours on course", () => {
    expect(s.avgMinutes).toBe(225);
    expect(s.fastestMinutes).toBe(210);
    expect(s.hoursOnCourse).toBeCloseTo(4 + 3.5 + 2, 6);
  });

  it("counts hole-game plays and wins against the real score", () => {
    expect(s.gamePlays).toBe(3);
    expect(s.gameWins).toBe(1);
  });

  it("is empty but sensible for a new golfer", () => {
    expect(profileStats([], new Map(), () => pars, [])).toMatchObject({ rounds: 0, avgScore: null, bestRound: null, avgMinutes: null, hoursOnCourse: 0 });
  });
});
