import { describe, expect, it } from "vitest";
import {
  aimPoint, CLUBS, distanceToPin, dropBeforeWater, lieAt, makeGameHole, MAX_STROKES, METER_MAX, newGame, ON_LINE, pickClub, putt, puttTarget,
  SWEET, swing, tapDirection, tapPower, toLatLng, toXY, holeWind, type GameHole, type GameState,
} from "./game";
import { playSequence } from "./courses";
import { course, features } from "./fixtures";

const seq = playSequence(course("redhawk"));
const steady = () => 0.5; // no random scatter
const straight: GameHole = {
  n: 1, par: 4, line: [[0, 0], [0, 350]], green: [0, 350], greenRadius: 14, origin: [33, -117],
  features: { fairways: [], bunkers: [], water: [], woods: [], trees: [] },
};
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

  it("a big miss off the tee is lost: stroke and distance, same spot", () => {
    const s = swing(newGame(straight), straight, 1, 1, steady);
    expect(s.shots[0].result).toBe("lost");
    expect(s.strokes).toBe(2);
    expect(s.ball).toEqual([0, 0]);
    expect(swing(newGame(straight), straight, 1, 0.15, steady).shots[0].result).toBe("fairway");
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

describe("two-tap swing", () => {
  it("direction: the green zone is dead straight, the edges are the biggest miss", () => {
    expect(tapDirection(0)).toBe(0);
    expect(tapDirection(ON_LINE * 0.9)).toBe(0);
    expect(tapDirection(1)).toBe(1);
    expect(tapDirection(-1)).toBe(-1);
    expect(tapDirection(0.5)).toBeGreaterThan(0);
  });
  it("speed: the green zone is full, early is short, late is long", () => {
    expect(tapPower((SWEET[0] + SWEET[1]) / 2)).toBe(1);
    expect(tapPower(0.46)).toBeCloseTo(0.5, 1);
    expect(tapPower(METER_MAX)).toBeCloseTo(METER_MAX, 6);
  });
});

describe("hazards", () => {
  const sq = (cx: number, cy: number, r: number): [number, number][] => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
  const hazards: GameHole = {
    ...straight,
    features: { fairways: [sq(0, 175, 18)], bunkers: [sq(25, 210, 8)], water: [sq(0, 250, 15)], woods: [sq(-50, 150, 15)], trees: [[40, 120]] },
  };

  it("reads the lie from the mapped polygons", () => {
    expect(lieAt([0, 175], hazards)).toBe("fairway");
    expect(lieAt([25, 210], hazards)).toBe("bunker");
    expect(lieAt([0, 250], hazards)).toBe("water");
    expect(lieAt([-50, 150], hazards)).toBe("trees");
    expect(lieAt([40, 122], hazards)).toBe("trees"); // next to a mapped tree
    expect(lieAt([25, 100], hazards)).toBe("rough"); // off the mapped fairway
    expect(lieAt([200, 100], hazards)).toBe("lost");
  });

  it("water: one penalty and a dry drop where it went in", () => {
    const s: GameState = { ...newGame(hazards), ball: [0, 175], lie: "fairway" };
    const drop = dropBeforeWater([0, 175], [0, 250], hazards);
    expect(lieAt(drop, hazards)).not.toBe("water");
    expect(drop[1]).toBeLessThan(235);
    // Going at the flag from 150 m and coming up short finds the water every time.
    const approach: GameState = { ...newGame(hazards), ball: [0, 200], lie: "fairway" };
    const wet = swing(approach, hazards, 0.4, 0, steady);
    expect(wet.shots[0].result).toBe("water");
    expect(wet.strokes).toBe(2);
    expect(lieAt(wet.ball, hazards)).not.toBe("water");
    expect(wet.ball[1]).toBeGreaterThan(200); // dropped where it went in, not back at the start
    expect(s.lie).toBe("fairway");
  });

  it("lays up short of water instead of aiming into it", () => {
    const s: GameState = { ...newGame(hazards), ball: [0, 70], lie: "fairway" };
    expect(lieAt(aimPoint(s, hazards), hazards)).not.toBe("water");
  });

  it("plays out of the trees shorter than from the fairway", () => {
    const from: [number, number] = [0, 0];
    const fw = swing({ ...newGame(straight), ball: from, lie: "fairway" }, straight, 1, 0, steady);
    const tr = swing({ ...newGame(straight), ball: from, lie: "trees" }, straight, 1, 0, steady);
    expect(distanceToPin(tr, straight)).toBeGreaterThan(distanceToPin(fw, straight));
  });
});

describe("the real courses", () => {
  it("perfect golf finishes every hole close to par, hazards and all", () => {
    for (const id of ["redhawk", "temecula-creek-inn"]) {
      const c = course(id);
      const seq = playSequence(c, c.nines ? [c.nines[0], c.nines[1]] : null);
      for (const h of seq) {
        const hole = makeGameHole(h, features(id));
        const s = playPerfect(hole);
        expect(s.holed).toBe(true);
        expect(s.strokes, `${id} hole ${h.n}`).toBeLessThanOrEqual(hole.par + 1);
      }
    }
  });
});

describe("wind", () => {
  it("each hole has its own steady breeze, calm to about 12 mph", () => {
    expect(holeWind(5)).toEqual(holeWind(5));
    for (let n = 1; n <= 18; n++) {
      const w = holeWind(n);
      expect(w.mph).toBeGreaterThanOrEqual(0);
      expect(w.mph).toBeLessThanOrEqual(12);
      expect(Math.hypot(...w.dir)).toBeCloseTo(1, 9);
    }
  });

  it("pushes the ball downwind, more on longer shots", () => {
    const breezy: GameHole = { ...straight, wind: { dir: [1, 0], mph: 10 } };
    const calm = swing(newGame(straight), straight, 1, 0, steady);
    const blown = swing(newGame(breezy), breezy, 1, 0, steady);
    expect(blown.ball[0] - calm.ball[0]).toBeGreaterThan(3); // drifted east
    expect(blown.ball[0] - calm.ball[0]).toBeLessThan(8);
  });
});

