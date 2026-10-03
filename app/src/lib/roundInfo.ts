import { courseLabel, playSequence, type CourseData, type PlayHole } from "./courses";
import { estimate, type PaceEstimate } from "./pace";
import type { Round } from "./db";

export interface RoundInfo {
  seq: PlayHole[];
  hole: PlayHole;
  est: PaceEstimate;
  label: string;
}

/** Everything a card needs, computed on this device from the stored round. */
export function roundInfo(round: Round, course: CourseData | undefined, now: number): RoundInfo | null {
  if (!course) return null;
  let seq: PlayHole[];
  try {
    seq = playSequence(course, round.nines);
  } catch {
    return null;
  }
  const est = estimate(
    {
      pars: seq.map((h) => h.par),
      teeTime: Date.parse(round.tee_time),
      targetMinutes: round.target_minutes,
      hole: round.hole,
      holeStartedAt: Date.parse(round.hole_started_at),
      holeFraction: round.hole_fraction,
      status: round.status,
      finishedAt: round.finished_at ? Date.parse(round.finished_at) : null,
    },
    now,
  );
  return { seq, hole: seq[round.hole - 1], est, label: courseLabel(course, round.nines) };
}
