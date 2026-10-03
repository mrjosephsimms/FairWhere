// "Play this hole": replay a friend's hole on the real map and try to beat their score.
// One tap per shot (stop the marker in the sweet spot). Engine: lib/game.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import type { LatLng, PlayHole as Hole } from "../lib/courses";
import { recordPlay, type Round } from "../lib/db";
import type { LiveData } from "../lib/hooks";
import {
  aimPoint, distanceToPin, makeGameHole, METER_MAX, newGame, pickClub, putt, puttTarget, SWEET, swing, tapToSwing, toLatLng,
  type GameState, type XY,
} from "../lib/game";
import { toYards } from "../lib/onCourse";
import type { GameOverlay } from "../components/MapView";

export interface GameView {
  overlay: GameOverlay;
  /** Camera: refit when `key` changes. */
  focus: { key: string; bounds: [[number, number], [number, number]] };
}

const LIE_NOTE: Record<string, string> = { fairway: "Fairway", rough: "In the rough", green: "On the green", tee: "On the tee" };

export function PlayHole({ round, hole, data, me, onView }: {
  round: Round;
  hole: Hole;
  data: LiveData;
  me: string;
  onView: (v: GameView | null) => void;
}) {
  const gh = useMemo(() => makeGameHole(hole), [hole]);
  const [state, setState] = useState<GameState>(() => newGame(gh));
  const [flying, setFlying] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [saved, setSaved] = useState<"no" | "saving" | "yes" | "error">("no");
  const ll = (p: XY): LatLng => toLatLng(gh.origin, p);

  const owner = round.user_id === me ? "You" : data.profiles.get(round.user_id)?.display_name || "Golfer";
  const theirs = data.scores.get(round.id)?.get(hole.n);
  const onGreen = state.lie === "green";
  const club = pickClub(state, gh);
  const yds = toYards(distanceToPin(state, gh));

  // Draw the ball, the shots so far and the aim line; frame ball -> flag.
  const publish = (s: GameState, ball: XY = s.ball, height = 0) => {
    const aim = s.holed ? null : ll(onGreenOf(s) ? gh.green : aimPoint(s, gh));
    const pts = [ll(s.ball), ll(gh.green), ...(aim ? [aim] : [])];
    const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]);
    onView({
      overlay: { ball: ll(ball), height, aim: height ? null : aim, trail: s.shots.map((x) => [ll(x.from), ll(x.to)]) },
      focus: { key: `game|${hole.n}|${s.strokes}|${s.shots.length}`, bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]] },
    });
  };
  useEffect(() => {
    publish(newGame(gh));
    return () => onView(null);
  }, [gh]);

  function hit(stop: number) {
    if (flying || state.holed) return;
    const next = onGreen ? putt(state, gh, stop) : (() => {
      const { power, aim } = tapToSwing(stop);
      return swing(state, gh, power, aim);
    })();
    const shot = next.shots[next.shots.length - 1];
    setFlying(true);
    setNote(null);
    animate(shot.from, shot.to, onGreen ? 650 : 1000, !onGreen, (p, h) => publish(state, p, h), () => {
      setFlying(false);
      setState(next);
      publish(next);
      setNote(
        shot.result === "lost" ? "Lost ball! +1 penalty, hit again from here."
        : shot.result === "holed" ? "In the hole!"
        : next.holed ? "Picked up at 10."
        : LIE_NOTE[shot.result] ?? null,
      );
      if (next.holed) {
        setSaved("saving");
        recordPlay(round.id, hole.n, next.strokes).then(() => (setSaved("yes"), data.reload())).catch(() => setSaved("error"));
      }
    });
  }

  function again() {
    const s = newGame(gh);
    setState(s);
    setNote(null);
    setSaved("no");
    publish(s);
  }

  const board = bestPerPlayer(data.plays.filter((p) => p.round_id === round.id && p.hole === hole.n));
  const name = (id: string) => (id === me ? "You" : data.profiles.get(id)?.display_name || "Golfer");

  return (
    <div className="game">
      <div className="game-head">
        <span><b>Hole {hole.n}</b> · Par {hole.par}{hole.yards ? ` · ${hole.yards} yds` : ""}</span>
        <span className="beat">{theirs != null ? <>{owner === "You" ? "Your score" : `${owner} made`} <b>{theirs}</b></> : `${owner} hasn't scored it yet`}</span>
      </div>

      {!state.holed ? (
        <>
          <p className="game-status">
            Stroke {state.strokes + 1} · <b>{onGreen ? `${Math.max(1, Math.round(distanceToPin(state, gh) * 3.28))} ft` : `${yds} yds`}</b> to the pin · {club.name}
            {note && <span className="game-note">{note}</span>}
          </p>
          <Meter putting={onGreen} target={onGreen ? puttTarget(state, gh) : undefined} disabled={flying} onStop={hit} />
          <p className="note center">{onGreen ? "Tap when the marker hits the notch" : "Tap in the green zone. Early is short, late slices."}</p>
        </>
      ) : (
        <div className="game-result">
          <b className="big-score">{state.strokes}</b>
          <span>{verdict(state.strokes, theirs, owner, hole.par)}</span>
          <span className="note">{saved === "saving" ? "Saving…" : saved === "yes" ? "Saved. Everyone following this round can see it." : saved === "error" ? "Couldn't save this one." : ""}</span>
          <button className="btn" onClick={again}>Play it again</button>
        </div>
      )}

      {board.length > 0 && (
        <div className="board">
          <span className="label">Hole {hole.n} leaderboard</span>
          {theirs != null && <div className="board-row real"><span>{owner} <small>on the course</small></span><b>{theirs}</b></div>}
          {board.slice(0, 5).map((p) => (
            <div key={p.player_id} className="board-row"><span>{name(p.player_id)}</span><b>{p.strokes}</b></div>
          ))}
        </div>
      )}
    </div>
  );
}

const onGreenOf = (s: GameState) => s.lie === "green";

function verdict(mine: number, theirs: number | undefined, owner: string, par: number): string {
  const vsPar = mine - par === 0 ? "Par" : mine < par ? (par - mine === 1 ? "Birdie!" : "Eagle!") : mine - par === 1 ? "Bogey" : `${mine - par} over`;
  if (theirs == null) return `${vsPar}. That's the score to beat.`;
  if (owner === "You") return mine < theirs ? `${vsPar}, better than your real ${theirs}.` : `${vsPar}. Real you made ${theirs}.`;
  return mine < theirs ? `${vsPar}. You beat ${owner}'s ${theirs}!` : mine === theirs ? `${vsPar}. Tied with ${owner}.` : `${vsPar}. ${owner} made ${theirs}.`;
}

function bestPerPlayer<T extends { player_id: string; strokes: number }>(plays: T[]): T[] {
  const best = new Map<string, T>();
  for (const p of plays) if (!best.has(p.player_id) || p.strokes < best.get(p.player_id)!.strokes) best.set(p.player_id, p);
  return [...best.values()].sort((a, b) => a.strokes - b.strokes);
}

/** Fly the ball from -> to; `lofted` shots rise and fall (the ball grows mid-air). */
function animate(from: XY, to: XY, ms: number, lofted: boolean, frame: (p: XY, height: number) => void, done: () => void) {
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min((t - t0) / ms, 1), e = lofted ? k : 1 - (1 - k) * (1 - k); // putts ease out
    frame([from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e], lofted ? Math.sin(Math.PI * k) : 0);
    if (k < 1) requestAnimationFrame(step);
    else done();
  };
  requestAnimationFrame(step);
}

/** The one-tap meter: a marker sweeps back and forth; tap to stop it. */
function Meter({ putting, target, disabled, onStop }: { putting: boolean; target?: number; disabled: boolean; onStop: (v: number) => void }) {
  const [v, setV] = useState(0);
  const vRef = useRef(0);
  useEffect(() => {
    if (disabled) return;
    const period = putting ? 1900 : 1500, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const x = ((t - t0) % period) / (period / 2); // 0..2
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
    <button className="meter" disabled={disabled} onClick={() => onStop(vRef.current)} aria-label={putting ? "Putt" : "Swing"}>
      <span className="meter-track">
        <span className="meter-zone" style={{ left: pct(zone[0]), width: `calc(${pct(zone[1])} - ${pct(zone[0])})` }} />
        <span className="meter-mark" style={{ left: pct(v) }} />
      </span>
      <span className="meter-label">{disabled ? "…" : putting ? "Tap to putt" : "Tap to swing"}</span>
    </button>
  );
}
