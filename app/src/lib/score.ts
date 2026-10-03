// Scorecard maths: totals and score-to-par for the holes entered so far.

export interface ScoreSummary {
  strokes: number;
  /** Strokes minus par over the holes scored. */
  toPar: number;
  /** How many holes have a score. */
  thru: number;
}

/** `scores` maps hole number (1..18) to strokes; `pars` is in play order (index 0 = hole 1). */
export function summarize(scores: Map<number, number>, pars: number[]): ScoreSummary {
  let strokes = 0, par = 0, thru = 0;
  for (const [hole, s] of scores) {
    if (hole < 1 || hole > pars.length) continue;
    strokes += s;
    par += pars[hole - 1];
    thru++;
  }
  return { strokes, toPar: strokes - par, thru };
}

/** "E", "+3", "−2" (true minus sign, like a leaderboard). */
export const fmtToPar = (n: number) => (n === 0 ? "E" : n > 0 ? `+${n}` : `−${-n}`);

/** Golf names for a single hole, for a little colour on the scorecard. */
export function holeResult(strokes: number, par: number): "eagle" | "birdie" | "par" | "bogey" | "double" {
  const d = strokes - par;
  return d <= -2 ? "eagle" : d === -1 ? "birdie" : d === 0 ? "par" : d === 1 ? "bogey" : "double";
}
