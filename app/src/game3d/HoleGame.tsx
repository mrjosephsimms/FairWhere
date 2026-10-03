// "Play this hole" as a little 3D video game: the real hole comes to life, a chibi
// golfer swings, the camera chases the ball. Rules: lib/game.ts. Show: director.ts.
// Loaded lazily (three.js only downloads when someone taps Play).
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlayHole } from "../lib/courses";
import { recordPlay, type GamePlay, type Profile } from "../lib/db";
import {
  aimPoint, distanceToPin, makeGameHole, METER_MAX, newGame, pickClub, putt, puttTarget, SWEET, swing, tapToSwing,
  type GameState,
} from "../lib/game";
import { toYards } from "../lib/onCourse";
import { colorFor } from "../components/Avatar";
import { Director } from "./director";
import { sfx } from "./sfx";

export interface HoleGameProps {
  roundId: string;
  hole: PlayHole;
  me: string;
  /** Who played it for real, and their score on this hole (if any). */
  owner: { id: string; name: string; score: number | undefined };
  plays: GamePlay[];
  profiles: Map<string, Profile>;
  /** Save the result (skipped in the dev demo). */
  save?: boolean;
  onSaved?: () => void;
  onClose: () => void;
}

type Phase = "intro" | "aim" | "busy" | "done";

const BUBBLE: Record<string, string> = { fairway: "Nice shot!", rough: "In the rough!", green: "On the green!", lost: "Lost ball! +1" };

export default function HoleGame({ roundId, hole, me, owner, plays, profiles, save = true, onSaved, onClose }: HoleGameProps) {
  const gh = useMemo(() => makeGameHole(hole), [hole]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const director = useRef<Director | null>(null);
  const [state, setState] = useState<GameState>(() => newGame(gh));
  const [phase, setPhase] = useState<Phase>("intro");
  const [bubble, setBubble] = useState<{ text: string; key: number } | null>(null);
  const [saved, setSaved] = useState<"no" | "saving" | "yes" | "error">("no");
  const [fade, setFade] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const say = (text: string) => setBubble({ text, key: Date.now() });

  useEffect(() => {
    const c = canvas.current!;
    const d = new Director(c, gh, colorFor(me));
    director.current = d;
    const fit = () => d.resize(c.clientWidth, c.clientHeight);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    const s = newGame(gh);
    d.setUp(s.ball, aimPoint(s, gh), false, false);
    d.start();
    d.intro(() => setPhase("aim"));
    return () => {
      ro.disconnect();
      d.dispose();
      director.current = null;
    };
  }, [gh, me]);

  /** Show the golfer at the ball for the next shot (with a quick fade between spots). */
  function setUpNext(s: GameState, moved: boolean) {
    const d = director.current!;
    const go = () => d.setUp(s.ball, s.lie === "green" ? gh.green : aimPoint(s, gh), s.lie === "green", true);
    if (!moved) return go(), setPhase("aim");
    setFade(true);
    setTimeout(() => (go(), setFade(false), setPhase("aim")), 280);
  }

  function hit(stop: number) {
    const d = director.current;
    if (!d || phase !== "aim") return;
    sfx.unlock();
    const s = stateRef.current;
    const onGreen = s.lie === "green";
    const next = onGreen ? putt(s, gh, stop) : (() => {
      const { power, aim } = tapToSwing(stop);
      return swing(s, gh, power, aim);
    })();
    const shot = next.shots[next.shots.length - 1];
    setPhase("busy");
    d.shoot(shot, next.holed && shot.result === "holed", () => {
      setState(next);
      if (next.holed) return finish(next);
      say(BUBBLE[shot.result] ?? "");
      setTimeout(() => setUpNext(next, shot.result !== "lost"), 700);
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
    setUpNext(s, true);
  }

  const onGreen = state.lie === "green";
  const club = pickClub(state, gh);
  const toPin = onGreen ? `${Math.max(1, Math.round(distanceToPin(state, gh) * 3.28))} ft` : `${toYards(distanceToPin(state, gh))} yds`;
  const board = bestPerPlayer(plays.filter((p) => p.round_id === roundId && p.hole === hole.n));
  const nameOf = (id: string) => (id === me ? "You" : profiles.get(id)?.display_name || "Golfer");

  return (
    <div className="hg">
      <canvas ref={canvas} className="hg-canvas" onClick={() => phase === "intro" && director.current?.skipIntro()} />
      <div className={`hg-fade${fade ? " on" : ""}`} />

      <div className="hg-top">
        <button className="hg-close" aria-label="Leave the game" onClick={onClose}>✕</button>
        <div className="hg-chip"><b>Hole {hole.n}</b> · Par {hole.par}</div>
        <div className="hg-chip right">
          {owner.score != null ? <>Beat <b>{owner.score}</b> <small>{owner.name}</small></> : <small>{owner.name} hasn't scored it</small>}
        </div>
      </div>

      {phase === "intro" && (
        <div className="hg-title" onClick={() => director.current?.skipIntro()}>
          <span className="hg-title-hole">HOLE {hole.n}</span>
          <span>Par {hole.par}{hole.yards ? ` · ${hole.yards} yds` : ""}</span>
        </div>
      )}

      {bubble && <div key={bubble.key} className="hg-bubble">{bubble.text}</div>}

      {phase !== "intro" && phase !== "done" && !state.holed && (
        <div className="hg-bottom">
          <div className="hg-info">
            <span>Stroke <b>{state.strokes + 1}</b></span>
            <span><b>{toPin}</b> to the pin</span>
            <span className="hg-club">{club.name}</span>
          </div>
          <Meter putting={onGreen} target={onGreen ? puttTarget(state, gh) : undefined} disabled={phase !== "aim"} onStop={hit} />
        </div>
      )}

      {phase === "done" && (
        <div className="hg-result">
          <span className="label">Hole {hole.n}</span>
          <b className="hg-score">{state.strokes}</b>
          <span className="hg-verdict">{verdict(state.strokes, owner.score, owner.name, gh.par, owner.id === me)}</span>
          {board.length > 0 && (
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

/** One tap per shot: a marker sweeps the bar; stop it in the green zone (or on the putt notch). */
function Meter({ putting, target, disabled, onStop }: { putting: boolean; target?: number; disabled: boolean; onStop: (v: number) => void }) {
  const [v, setV] = useState(0);
  const vRef = useRef(0);
  useEffect(() => {
    if (disabled) return;
    const period = putting ? 1900 : 1500, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const x = ((t - t0) % period) / (period / 2);
      vRef.current = METER_MAX * (x < 1 ? x : 2 - x);
      setV(vRef.current);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [disabled, putting]);
  const pct = (x: number) => `${(x / METER_MAX) * 100}%`;
  const zone: [number, number] = putting && target != null ? [Math.max(0, target - 0.03), Math.min(METER_MAX, target + 0.03)] : SWEET;
  return (
    <button className="hg-meter" disabled={disabled} onPointerDown={() => onStop(vRef.current)} aria-label={putting ? "Putt" : "Swing"}>
      <span className="hg-track">
        <span className="hg-zone" style={{ left: pct(zone[0]), width: `calc(${pct(zone[1])} - ${pct(zone[0])})` }} />
        <span className="hg-mark" style={{ left: pct(v) }} />
      </span>
      <span className="hg-tap">{disabled ? " " : putting ? "TAP TO PUTT" : "TAP TO SWING"}</span>
    </button>
  );
}
