// "Play this hole" as a little 3D golf game on the real hole (Wii Sports-style):
// tap once for direction, once for power; watch the swing, chase the ball, walk up
// to it. Rules: lib/game.ts. Show: director.ts. Loaded lazily (three.js only
// downloads when someone taps Play).
import { useEffect, useMemo, useRef, useState } from "react";
import type { CourseFeatures, PlayHole } from "../lib/courses";
import { getCourseFeatures, recordPlay, type GamePlay, type Profile } from "../lib/db";
import {
  aimPoint, distanceToPin, makeGameHole, METER_MAX, newGame, ON_LINE, pickClub, putt, puttTarget, SWEET, swing, tapDirection, tapPower,
  type Club, type GameHole, type GameState, type XY,
} from "../lib/game";
import { toYards } from "../lib/onCourse";
import { colorFor } from "../components/Avatar";
import { Director } from "./director";
import { sfx } from "./sfx";

export interface HoleGameProps {
  roundId: string;
  courseId: string;
  hole: PlayHole;
  me: string;
  /** Who played it for real, and their score on this hole (if any). */
  owner: { id: string; name: string; score: number | undefined };
  plays: GamePlay[];
  profiles: Map<string, Profile>;
  /** Mapped course features; fetched from the courses table when not given. */
  features?: CourseFeatures | null;
  /** Save the result (skipped in the dev demo). */
  save?: boolean;
  onSaved?: () => void;
  onClose: () => void;
}

/** Load the course's mapped features (bunkers, water, trees...) before building the hole. */
export default function HoleGame(props: HoleGameProps) {
  const [features, setFeatures] = useState<CourseFeatures | null | undefined>(props.features);
  useEffect(() => {
    if (props.features !== undefined) return;
    getCourseFeatures(props.courseId).then(setFeatures).catch(() => setFeatures(null)); // play on a plain course if it fails
  }, [props.courseId, props.features]);
  if (features === undefined) return <div className="hg-loading">Loading the course…</div>;
  return <Game {...props} features={features} />;
}

type Phase = "intro" | "aim" | "power" | "busy" | "done";
const FAR_WALK_M = 30;

const BUBBLE: Record<string, string> = {
  fairway: "Nice shot!", rough: "In the rough", trees: "In the trees!", bunker: "Sand trap!", green: "On the green!",
  water: "Splash! +1", lost: "Out of bounds! +1",
};

function Game({ roundId, hole, me, owner, plays, profiles, features, save = true, onSaved, onClose }: HoleGameProps & { features: CourseFeatures | null }) {
  const gh = useMemo(() => makeGameHole(hole, features), [hole, features]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const director = useRef<Director | null>(null);
  const [state, setState] = useState<GameState>(() => newGame(gh));
  const [phase, setPhase] = useState<Phase>("intro");
  const [bubble, setBubble] = useState<{ text: string; key: number } | null>(null);
  const [saved, setSaved] = useState<"no" | "saving" | "yes" | "error">("no");
  const [fade, setFade] = useState(false);
  const aimRef = useRef(0); // locked direction (-1..1) between the two taps
  const dirMeter = useRef(0); // live direction meter value (-1..1)
  const powMeter = useRef(0); // live power meter value (0..METER_MAX)
  const stateRef = useRef(state);
  stateRef.current = state;

  const say = (text: string) => setBubble({ text, key: Date.now() });
  const aimOf = (s: GameState): XY => (s.lie === "green" ? gh.green : aimPoint(s, gh));
  const clubOf = (s: GameState): Club["kind"] => pickClub(s, gh).kind;

  // Build the scene once per hole (aimOf/clubOf only read `gh`).
  useEffect(() => {
    const c = canvas.current!;
    const d = new Director(c, gh, colorFor(me));
    director.current = d;
    const fit = () => d.resize(c.clientWidth, c.clientHeight);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    const s = newGame(gh);
    d.setUp(s.ball, aimOf(s), false, clubOf(s), false);
    d.start();
    d.intro(() => setPhase("aim"));
    return () => {
      ro.disconnect();
      d.dispose();
      director.current = null;
    };
  }, [gh, me]);

  const ready = (s: GameState) => setPhase(s.lie === "green" ? "power" : "aim");

  /** Walk up to the ball for the next shot (long walks start close, after a quick cut). */
  function walkToNext(s: GameState) {
    const d = director.current!;
    const go = (headStart: number | null) => d.walkTo(s.ball, aimOf(s), s.lie === "green", clubOf(s), headStart, () => ready(s));
    if (d.walkDistance(s.ball, aimOf(s)) <= FAR_WALK_M) return go(null);
    setFade(true);
    setTimeout(() => (go(14), setFade(false)), 280);
  }

  /** One tap anywhere: lock the direction, then the power. */
  function tap() {
    const d = director.current;
    if (!d) return;
    if (phase === "intro") return d.skipIntro();
    sfx.unlock();
    if (phase === "aim") {
      aimRef.current = dirMeter.current;
      d.previewAim(tapDirection(aimRef.current));
      return setPhase("power");
    }
    if (phase !== "power") return;
    const s = stateRef.current;
    const onGreen = s.lie === "green";
    const next = onGreen ? putt(s, gh, powMeter.current) : swing(s, gh, tapPower(powMeter.current), tapDirection(aimRef.current));
    const shot = next.shots[next.shots.length - 1];
    setPhase("busy");
    d.shoot(shot, next.holed && shot.result === "holed", () => {
      setState(next);
      if (next.holed) return finish(next);
      say(BUBBLE[shot.result] ?? "");
      setTimeout(() => walkToNext(next), 650);
    });
  }

  function finish(s: GameState) {
    const d = director.current!;
    const good = s.strokes <= gh.par || (owner.score != null && s.strokes < owner.score);
    say(s.strokes === 1 ? "HOLE IN ONE!" : resultWord(s.strokes, gh.par));
    good ? d.celebrate() : d.sad();
    setTimeout(() => setPhase("done"), 1600);
    if (!save) return;
    setSaved("saving");
    recordPlay(roundId, hole.n, s.strokes).then(() => (setSaved("yes"), onSaved?.())).catch(() => setSaved("error"));
  }

  function again() {
    const s = newGame(gh);
    setState(s);
    setSaved("no");
    setBubble(null);
    setFade(true);
    setTimeout(() => {
      director.current?.setUp(s.ball, aimOf(s), false, clubOf(s), true);
      setFade(false);
      setPhase("aim");
    }, 280);
  }

  const onGreen = state.lie === "green";
  const club = pickClub(state, gh);
  const left = onGreen ? `${Math.max(1, Math.round(distanceToPin(state, gh) * 3.28))} ft` : `${toYards(distanceToPin(state, gh))} yds`;
  const board = bestPerPlayer(plays.filter((p) => p.round_id === roundId && p.hole === hole.n));
  const nameOf = (id: string) => (id === me ? "You" : profiles.get(id)?.display_name || "Golfer");
  const playing = phase !== "intro" && phase !== "done" && !state.holed;

  // Wind relative to where we're aiming: arrow pointing up = blowing toward the target.
  const aimDir = aimOf(state);
  const shotAngle = Math.atan2(aimDir[1] - state.ball[1], aimDir[0] - state.ball[0]);
  const wind = gh.wind;
  const windRel = wind ? ((shotAngle - Math.atan2(wind.dir[1], wind.dir[0])) * 180) / Math.PI : 0;

  return (
    <div className="hg" onPointerDown={(e) => !(e.target as HTMLElement).closest("button") && tap()}>
      <canvas ref={canvas} className="hg-canvas" />
      <div className={`hg-fade${fade ? " on" : ""}`} />

      <div className="hg-top">
        <button className="hg-close" aria-label="Leave the game" onClick={onClose}>✕</button>
        <div className="hg-chip"><b>Hole {hole.n}</b> · Par {hole.par}</div>
        <div className="hg-panel">
          <div className="hg-left"><b>{left}</b> left</div>
          {wind && (
            <div className="hg-wind">
              <svg viewBox="0 0 24 24" width="22" height="22" style={{ transform: `rotate(${windRel}deg)` }} aria-hidden>
                <path d="M12 2 19 13h-4.5v9h-5v-9H5z" fill="currentColor" />
              </svg>
              <span><b>{wind.mph}</b> mph</span>
            </div>
          )}
          <div className="hg-beat">{owner.score != null ? <>Beat <b>{owner.score}</b> · {owner.name}</> : `${owner.name} hasn't scored it`}</div>
        </div>
      </div>

      {phase === "intro" && (
        <div className="hg-title">
          <span className="hg-title-hole">HOLE {hole.n}</span>
          <span>Par {hole.par}{hole.yards ? ` · ${hole.yards} yds` : ""}</span>
          <small>Tap to start</small>
        </div>
      )}

      {bubble && <div key={bubble.key} className="hg-bubble">{bubble.text}</div>}

      {playing && (
        <>
          <PowerMeter active={phase === "power"} putting={onGreen} target={onGreen ? puttTarget(state, gh) : undefined} value={powMeter} />
          {!onGreen && <DirectionMeter active={phase === "aim"} value={dirMeter} locked={phase !== "aim" ? aimRef.current : null} onMove={(v) => director.current?.previewAim(tapDirection(v))} />}
          <div className="hg-club">
            <ClubIcon kind={club.kind} />
            <span><b>{club.name}</b><small>Stroke {state.strokes + 1}</small></span>
          </div>
          <MiniMap hole={gh} state={state} />
          <div className="hg-hint">{phase === "aim" ? "Tap to aim: stop it in the green" : phase === "power" ? (onGreen ? "Tap when it hits the notch" : "Tap for power: stop it in the green") : ""}</div>
        </>
      )}

      {phase === "done" && (
        <div className="hg-result">
          <span className="label">Hole {hole.n}</span>
          <b className="hg-score">{state.strokes}</b>
          <span className="hg-verdict">{verdict(state.strokes, owner.score, owner.name, gh.par, owner.id === me)}</span>
          {(board.length > 0 || owner.score != null) && (
            <div className="hg-board">
              {owner.score != null && <div className="real"><span>{owner.name} <small>on the course</small></span><b>{owner.score}</b></div>}
              {board.slice(0, 4).map((p) => <div key={p.player_id}><span>{nameOf(p.player_id)}</span><b>{p.strokes}</b></div>)}
            </div>
          )}
          <span className="note">{saved === "saving" ? "Saving…" : saved === "yes" ? "Saved. Everyone following the round can see it." : saved === "error" ? "Couldn't save this one." : ""}</span>
          <div className="actions">
            <button className="btn" onClick={again}>Play again</button>
            <button className="btn ghost" onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function resultWord(strokes: number, par: number) {
  const d = strokes - par;
  return d <= -2 ? "EAGLE!" : d === -1 ? "BIRDIE!" : d === 0 ? "PAR!" : d === 1 ? "Bogey" : `+${d}`;
}

function verdict(mine: number, theirs: number | undefined, owner: string, par: number, own: boolean): string {
  const word = mine - par === 0 ? "Par" : mine < par ? (par - mine === 1 ? "Birdie" : "Eagle") : mine - par === 1 ? "Bogey" : `${mine - par} over par`;
  if (theirs == null) return `${word}. That's the score to beat!`;
  if (own) return mine < theirs ? `${word}, better than the real you (${theirs}).` : `${word}. The real you made ${theirs}.`;
  return mine < theirs ? `${word}! You beat ${owner}'s ${theirs} 🏆` : mine === theirs ? `${word}. Tied with ${owner}.` : `${word}. ${owner} made ${theirs}. Again?`;
}

function bestPerPlayer<T extends { player_id: string; strokes: number }>(plays: T[]): T[] {
  const best = new Map<string, T>();
  for (const p of plays) if (!best.has(p.player_id) || p.strokes < best.get(p.player_id)!.strokes) best.set(p.player_id, p);
  return [...best.values()].sort((a, b) => a.strokes - b.strokes);
}

/** A marker sweeping back and forth while `active`; writes its value into `out` (each meter has its own). */
function useSweep(active: boolean, period: number, lo: number, hi: number, out: React.MutableRefObject<number>, onMove?: (v: number) => void) {
  const [v, setV] = useState(lo);
  const cb = useRef(onMove);
  cb.current = onMove;
  useEffect(() => {
    if (!active) return;
    // Start every sweep from the bottom: a tap before the first frame mustn't reuse last shot's value.
    out.current = lo;
    setV(lo);
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const x = ((t - t0) % period) / (period / 2);
      const val = lo + (hi - lo) * (x < 1 ? x : 2 - x);
      out.current = val;
      setV(val);
      cb.current?.(val);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, period, lo, hi, out]);
  return v;
}

/** Tap 1: left/right. The green middle is dead straight; the ends find trouble. */
function DirectionMeter({ active, value, locked, onMove }: { active: boolean; value: React.MutableRefObject<number>; locked: number | null; onMove: (v: number) => void }) {
  const v = useSweep(active, 1300, -1, 1, value, onMove);
  const shown = locked ?? v;
  const pct = (x: number) => `${((x + 1) / 2) * 100}%`;
  return (
    <div className={`hg-dir${active ? " live" : ""}`} aria-hidden>
      <span className="hg-dir-zone" style={{ left: pct(-ON_LINE), width: `calc(${pct(ON_LINE)} - ${pct(-ON_LINE)})` }} />
      <span className="hg-dir-mark" style={{ left: pct(shown) }} />
    </div>
  );
}

/** Tap 2: power, Wii-style vertical bar on the left. Putts get a notch instead of a zone. */
function PowerMeter({ active, putting, target, value }: { active: boolean; putting: boolean; target?: number; value: React.MutableRefObject<number> }) {
  const v = useSweep(active, putting ? 1900 : 1500, 0, METER_MAX, value);
  const pct = (x: number) => `${(x / METER_MAX) * 100}%`;
  const zone: [number, number] = putting && target != null ? [Math.max(0, target - 0.03), Math.min(METER_MAX, target + 0.03)] : SWEET;
  return (
    <div className={`hg-power${active ? " live" : ""}`} aria-hidden>
      <span className="hg-power-zone" style={{ bottom: pct(zone[0]), height: `calc(${pct(zone[1])} - ${pct(zone[0])})` }} />
      {[0.25, 0.5, 0.75].map((x) => <i key={x} style={{ bottom: pct(x * METER_MAX) }} />)}
      <span className="hg-power-mark" style={{ bottom: pct(active ? v : 0) }} />
    </div>
  );
}

function ClubIcon({ kind }: { kind: Club["kind"] }) {
  const head =
    kind === "driver" ? <ellipse cx="9" cy="25" rx="7" ry="4.5" fill="#2a2f3a" />
    : kind === "wood" ? <ellipse cx="9" cy="25" rx="5.5" ry="3.8" fill="#2a2f3a" />
    : kind === "putter" ? <rect x="2" y="23" width="13" height="4" rx="1" fill="#c9ced6" />
    : <path d="M4 22h9l-2 6H3z" fill="#c9ced6" />;
  return (
    <svg className="hg-club-icon" viewBox="0 0 32 32" width="34" height="34" aria-hidden>
      <path d="M27 3 12 23" stroke="#9aa3b0" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M27 3l-3 4" stroke="#222" strokeWidth="4" strokeLinecap="round" />
      {head}
    </svg>
  );
}

/** Top-down map of the real hole (tee at the bottom, green at the top) with the ball and aim line. */
function MiniMap({ hole, state }: { hole: GameHole; state: GameState }) {
  const W = 96, H = 160, pad = 10;
  const view = useMemo(() => {
    const tee = hole.line[0], g = hole.green;
    const ang = Math.atan2(g[1] - tee[1], g[0] - tee[0]) - Math.PI / 2; // rotate so the hole points up
    const rot = (p: XY): XY => {
      const x = p[0] - tee[0], y = p[1] - tee[1], c = Math.cos(-ang), s = Math.sin(-ang);
      return [x * c - y * s, x * s + y * c];
    };
    const pts = hole.line.map(rot);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const span = Math.max(Math.max(...ys) - Math.min(...ys), 1), wide = Math.max(Math.max(...xs) - Math.min(...xs), 60);
    const k = Math.min((H - 2 * pad) / span, (W - 2 * pad) / wide);
    const mx = (Math.max(...xs) + Math.min(...xs)) / 2, my = Math.min(...ys);
    const to = (p: XY): XY => {
      const q = rot(p);
      return [W / 2 + (q[0] - mx) * k, H - pad - (q[1] - my) * k];
    };
    const path = (poly: XY[]) => poly.map((p, i) => `${i ? "L" : "M"}${to(p).map((v) => v.toFixed(1)).join(" ")}`).join("") + "Z";
    return { to, path, k };
  }, [hole]);
  const f = hole.features;
  const ball = view.to(state.ball), aim = view.to(state.lie === "green" ? hole.green : aimPoint(state, hole)), green = view.to(hole.green);
  return (
    <svg className="hg-map" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-label="Hole map">
      <rect width={W} height={H} rx="10" fill="#3f8a3c" />
      {f.woods.map((p, i) => <path key={`w${i}`} d={view.path(p)} fill="#2f6e33" />)}
      {f.fairways.length ? f.fairways.map((p, i) => <path key={`f${i}`} d={view.path(p)} fill="#7fd05c" />)
        : <path d={hole.line.map((p, i) => `${i ? "L" : "M"}${view.to(p).join(" ")}`).join("")} stroke="#7fd05c" strokeWidth={36 * view.k} fill="none" strokeLinecap="round" />}
      {f.water.map((p, i) => <path key={`h${i}`} d={view.path(p)} fill="#3aa6e0" />)}
      {f.bunkers.map((p, i) => <path key={`b${i}`} d={view.path(p)} fill="#f3e2ae" />)}
      <circle cx={green[0]} cy={green[1]} r={Math.max(hole.greenRadius * view.k, 4)} fill="#a6ec7c" />
      <circle cx={green[0]} cy={green[1]} r="2" fill="#ff4b4b" />
      <line x1={ball[0]} y1={ball[1]} x2={aim[0]} y2={aim[1]} stroke="#2f7cf6" strokeWidth="1.6" />
      <circle cx={ball[0]} cy={ball[1]} r="3" fill="#fff" stroke="#1d2b20" strokeWidth="1" />
    </svg>
  );
}
