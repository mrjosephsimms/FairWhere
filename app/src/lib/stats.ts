// Profile stats, computed from your own finished rounds, scorecards and hole-game plays.
// Shown only on your profile (Me tab).
import type { GamePlay, Round } from "./db";

export interface ProfileStats {
  rounds: number;
  holes: number;
  favoriteCourse: string | null;
  /** Over complete (18-hole) scorecards only. */
  avgScore: number | null;
  bestRound: { strokes: number; toPar: number; roundId: string } | null;
  birdies: number;
  pars: number;
  /** Over rounds played to the 18th. */
  avgMinutes: number | null;
  fastestMinutes: number | null;
  hoursOnCourse: number;
  gamePlays: number;
  gameWins: number;
}

const minutes = (r: Round) =>
  r.finished_at ? (Date.parse(r.finished_at) - Date.parse(r.tee_time)) / 60000 : NaN;
/** Rounds left running for half a day (forgot to finish) don't count toward time stats. */
const sane = (m: number) => m > 30 && m < 12 * 60;

export function profileStats(
  rounds: Round[],
  scores: Map<string, Map<number, number>>,
  parsOf: (r: Round) => number[] | null,
  plays: GamePlay[],
): ProfileStats {
  const done = rounds.filter((r) => r.status === "done");
  const byCourse = new Map<string, number>();
  done.forEach((r) => byCourse.set(r.course_id, (byCourse.get(r.course_id) ?? 0) + 1));
  const favoriteCourse = [...byCourse].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  let birdies = 0, pars = 0;
  const totals: { strokes: number; toPar: number; roundId: string }[] = [];
  for (const r of done) {
    const card = scores.get(r.id), p = parsOf(r);
    if (!card || !p) continue;
    for (const [hole, s] of card) {
      const par = p[hole - 1];
      if (par == null) continue;
      if (s <= par - 1) birdies++;
      else if (s === par) pars++;
    }
    if (card.size === 18) {
      const strokes = [...card.values()].reduce((a, b) => a + b, 0);
      totals.push({ strokes, toPar: strokes - p.reduce((a, b) => a + b, 0), roundId: r.id });
    }
  }

  const full = done.filter((r) => r.hole === 18).map(minutes).filter(sane);
  const all = done.map(minutes).filter(sane);
  return {
    rounds: done.length,
    holes: done.reduce((s, r) => s + r.hole, 0),
    favoriteCourse,
    avgScore: totals.length ? totals.reduce((s, t) => s + t.strokes, 0) / totals.length : null,
    bestRound: totals.length ? totals.reduce((a, b) => (b.strokes < a.strokes ? b : a)) : null,
    birdies,
    pars,
    avgMinutes: full.length ? full.reduce((a, b) => a + b, 0) / full.length : null,
    fastestMinutes: full.length ? Math.min(...full) : null,
    hoursOnCourse: all.reduce((a, b) => a + b, 0) / 60,
    gamePlays: plays.length,
    gameWins: plays.filter((p) => p.to_beat != null && p.strokes < p.to_beat).length,
  };
}
