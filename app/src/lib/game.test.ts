import { describe, expect, it } from "vitest";
import { aimPoint, CLUBS, METER_MAX, SWEET, tapToSwing, distanceToPin, lieAt, makeGameHole, MAX_STROKES, newGame, pickClub, putt, puttTarget, swing, toLatLng, toXY, type GameState } from "./game";
import { playSequence } from "./courses";
import { course } from "./fixtures";

const seq = playSequence(course("redhawk"));
const steady = () => 0.5; // no random scatter
const par4 = makeGameHole(seq.find((h) => h.par === 4 && h.centerline.length >= 2)!);

/** Perfect swings until on the green, then perfect putts. */
function playPerfect(hole = par4) {
  let s: GameState = newGame(hole);
  for (let i = 0; i < 20 && !s.holed; i++) s = s.lie === "green" ? putt(s, hole, puttTarget(s, hole)) : swing(s, hole, 1, 0, steady);
  return s;
}

describe("frame", () => {
  it("round-trips lat/lng through the local metre frame", () => {
    const o = seq[0].centerline[0];
    const p = seq[0].centerline[1];
    const back = toLatLng(o, toXY(o, p));
    expect(back[0]).toBeCloseTo(p[0], 9);
    expect(back[1]).toBeCloseTo(p[1], 9);
  });
});

describe("clubs and aim", () => {
  it("hits driver off the tee of a par 4, and never from the fairway", () => {
    const s = newGame(par4);
    expect(pickClub(s, par4).name).toBe("Driver");
    expect(pickClub({ ...s, lie: "fairway" }, par4).name).not.toBe("Driver");
  });

  it("takes less club when close, and the putter on the green", () => {
    const near: GameState = { ...newGame(par4), ball: [par4.green[0], par4.green[1] - 60], lie: "fairway" };
    expect(pickClub(near, par4).carry).toBeLessThan(CLUBS[0].carry);
    expect(pickClub({ ...near, lie: "green" }, par4).name).toBe("Putter");
  });

  it("aims down the hole's line, at the flag once in reach", () => {
    const s = newGame(par4);
    expect(lieAt(aimPoint(s, par4), par4)).not.toBe("lost");
    const near: GameState = { ...s, ball: [par4.green[0], par4.green[1] - 50], lie: "fairway" };
    expect(aimPoint(near, par4)).toEqual(par4.green);
  });
});

describe("playing a hole", () => {
  it("perfect golf makes par or better", () => {
    const s = playPerfect();
    expect(s.holed).toBe(true);
    expect(s.strokes).toBeLessThanOrEqual(par4.par);
  });

  it("perfect golf works on every hole at Redhawk", () => {
    for (const h of seq) {
      const hole = makeGameHole(h);
      const s = playPerfect(hole);
      expect(s.holed).toBe(true);
      expect(s.strokes).toBeLessThanOrEqual(hole.par + 1);
    }
  });

  it("a big slice off the tee is lost: stroke and distance, same spot", () => {
    const straight = { n: 1, par: 4, line: [[0, 0], [0, 350]] as [number, number][], green: [0, 350] as [number, number], greenRadius: 14, origin: [33, -117] as [number, number] };
    const s = swing(newGame(straight), straight, 1, 1, steady);
    expect(s.shots[0].result).toBe("lost");
    expect(s.strokes).toBe(2);
    expect(s.ball).toEqual([0, 0]);
    expect(swing(newGame(straight), straight, 1, 0.3, steady).shots[0].result).toBe("fairway");
  });

  it("knows fairway, rough and lost by distance off the line", () => {
    const mid = par4.line[0];
    const along: [number, number] = [mid[0], mid[1]];
    expect(lieAt(along, par4)).not.toBe("lost");
    expect(lieAt([along[0] + 500, along[1] + 500], par4)).toBe("lost");
  });

  it("a soft swing comes up short", () => {
    const s = swing(newGame(par4), par4, 0.3, 0, steady);
    expect(distanceToPin(s, par4)).toBeGreaterThan(distanceToPin(swing(newGame(par4), par4, 1, 0, steady), par4));
  });
});

describe("putting", () => {
  const onGreen = (m: number): GameState => ({ ...newGame(par4), ball: [par4.green[0], par4.green[1] - m], lie: "green", strokes: 2 });

  it("a perfectly judged putt drops", () => {
    const s = onGreen(8);
    expect(putt(s, par4, puttTarget(s, par4))).toMatchObject({ holed: true, strokes: 3 });
  });

  it("a weak putt stays short, on the same line", () => {
    const s = onGreen(8);
    const after = putt(s, par4, puttTarget(s, par4) * 0.5);
    expect(after.holed).toBe(false);
    expect(distanceToPin(after, par4)).toBeCloseTo(4, 0);
    expect(after.ball[1]).toBeLessThan(par4.green[1]); // still on the near side
  });

  it("picks it up at the maximum", () => {
    let s = { ...onGreen(20), strokes: MAX_STROKES - 1 };
    s = putt(s, par4, 0);
    expect(s).toMatchObject({ holed: true, strokes: MAX_STROKES });
  });
});

describe("one-tap swing", () => {
  it("the sweet spot is full and straight", () => {
    expect(tapToSwing((SWEET[0] + SWEET[1]) / 2)).toEqual({ power: 1, aim: 0 });
  });
  it("early is short with a slight pull", () => {
    const t = tapToSwing(0.6);
    expect(t.power).toBeLessThan(1);
    expect(t.aim).toBeLessThan(0);
    expect(t.aim).toBeGreaterThan(-1);
  });
  it("late is an over-swing that slices, hard at the very end", () => {
    const t = tapToSwing(METER_MAX);
    expect(t.power).toBeCloseTo(METER_MAX, 6);
    expect(t.aim).toBe(1);
  });
});
