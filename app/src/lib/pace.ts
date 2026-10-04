// Finish-time model. Ported from reference/pace.js (HANDOFF §5).
// Times are epoch ms; durations in minutes. Runs on the VIEWER's device from
// the stored round fields, so the ETA keeps ticking without any writes.

/** Relative time per par: a par 5 takes ~1.22x a par 4, a par 3 ~0.78x. */
export const PAR_WEIGHT: Record<number, number> = { 3: 0.78, 4: 1.0, 5: 1.22 };
const weight = (par: number) => PAR_WEIGHT[par] ?? (par > 5 ? 1.44 : 1.0);

export type Mode = "walking" | "riding";

/** Default usual round length (minutes): walkers typically take 20-30 min longer than a cart. */
export const DEFAULT_TARGET: Record<Mode, number> = { riding: 240, walking: 270 };

/** Share of a walker's hole time that scales with the hole's length rather than its par. */
const WALK_YARDS_SHARE = 0.35;

/**
 * Split a target round time (minutes) across holes. Riding: by par weight (the cart
 * makes distance cheap). Walking: part par weight, part yardage, since a long hole
 * takes noticeably longer on foot. Holes with unknown yardage fall back to par weight.
 */
export function allocate(pars: number[], targetMinutes: number, opts: { mode?: Mode; yards?: (number | null)[] } = {}): number[] {
  let w = pars.map(weight);
  const yards = opts.yards;
  if (opts.mode === "walking" && yards && yards.length === pars.length) {
    const known = yards.filter((y): y is number => y != null && y > 0);
    if (known.length) {
      const avgYards = known.reduce((s, y) => s + y, 0) / known.length;
      const avgW = w.reduce((s, x) => s + x, 0) / w.length;
      w = w.map((x, i) => {
        const y = yards[i];
        return y != null && y > 0 ? (1 - WALK_YARDS_SHARE) * x + WALK_YARDS_SHARE * avgW * (y / avgYards) : x;
      });
    }
  }
  const total = w.reduce((s, x) => s + x, 0);
  return w.map((x) => (targetMinutes * x) / total);
}

export interface PaceInput {
  /** Par of each hole in play order (18). */
  pars: number[];
  teeTime: number;
  /** Usual round length; default 255 = 4h15. */
  targetMinutes?: number;
  /** Current hole 1..18. */
  hole: number;
  /** When the golfer reached the current hole. */
  holeStartedAt?: number | null;
  /** 0..1 progress along the hole from GPS; overrides the time-based guess. */
  holeFraction?: number | null;
  status: "live" | "done" | "cancelled";
  finishedAt?: number | null;
  /** Walking splits the round partly by yardage; default riding. */
  mode?: Mode;
  /** Yards of each hole in play order, when known. */
  yards?: (number | null)[];
}

export interface PaceEstimate {
  phase: "pre" | "live" | "done";
  /** Estimated (or actual) finish, epoch ms. */
  eta: number;
  /** Minutes behind usual pace (> 0) or ahead (< 0). */
  deltaMin: number;
  frac?: number;
}

export function estimate(round: PaceInput, now: number): PaceEstimate {
  const a = allocate(round.pars, round.targetMinutes || 255, { mode: round.mode, yards: round.yards });
  const total = a.reduce((x, y) => x + y, 0);
  const tee = round.teeTime;

  if (round.status !== "live") {
    const end = round.finishedAt ?? now;
    return { phase: "done", eta: end, deltaMin: (end - tee) / 60000 - total };
  }
  if (now < tee) return { phase: "pre", eta: tee + total * 60000, deltaMin: 0 };

  const h = Math.min(Math.max(round.hole || 1, 1), 18);
  const before = a.slice(0, h - 1).reduce((x, y) => x + y, 0);
  const onHoleMin = Math.max(0, (now - (round.holeStartedAt || tee)) / 60000);
  // Never assume the hole is more than 90% done from time alone.
  const frac = round.holeFraction != null ? round.holeFraction : Math.min(onHoleMin / a[h - 1], 0.9);
  const expected = before + frac * a[h - 1]; // minutes a usual-pace golfer would have used by now
  const elapsed = (now - tee) / 60000;
  // Pace factor: ignore the first ~20 min (noise), clamp outliers.
  let p = expected > 20 ? elapsed / expected : 1;
  p = Math.min(Math.max(p, 0.8), 1.5);
  const remaining = (total - expected) * p;
  return { phase: "live", eta: now + remaining * 60000, deltaMin: elapsed - expected, frac };
}

export type PaceTone = "good" | "warn" | "bad" | "idle";

/** The ahead/behind chip: within ±5 min is "On pace"; > 15 min behind is red. */
export function paceChip(est: PaceEstimate): { label: string; tone: PaceTone } {
  if (est.phase === "pre") return { label: "Not started", tone: "idle" };
  if (est.phase === "done") return { label: "Finished", tone: "idle" };
  const d = Math.round(est.deltaMin);
  if (Math.abs(d) <= 5) return { label: "On pace", tone: "good" };
  if (d < 0) return { label: `${-d} min ahead`, tone: "good" };
  return { label: `${d} min behind`, tone: d > 15 ? "bad" : "warn" };
}
