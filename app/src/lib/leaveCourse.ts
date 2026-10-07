// "Are you at the course?" and "have you left it?", from GPS fixes and the course's
// hole lines. Pure + tested; used by the round tracker (auto-finish) and the
// Start a Round check.
import type { CourseData, LatLng } from "./courses";
import { nearestOnLine } from "./holeDetect";

/** Metres from a point to the nearest bit of any hole on the course. */
export function metresFromCourse(course: Pick<CourseData, "holes">, pt: LatLng): number {
  let best = Infinity;
  for (const h of course.holes) best = Math.min(best, nearestOnLine(h.centerline, pt).d);
  return best;
}

/** Further than this from every hole when starting a round: "doesn't look like you're at a golf course". */
export const AWAY_FROM_COURSE_M = 1000;
/** Within this, you've definitely been on the course this round. */
const ON_COURSE_M = 200;

export interface LeaveOptions {
  /** Off the course (beyond the car park) by this much... */
  offM?: number;
  /** ...for this long means you've left. */
  minMs?: number;
  /** Or this far away on `goneFixes` fixes in a row (driving home). */
  goneM?: number;
  goneFixes?: number;
}

/**
 * Feed it each fix's distance from the course; it returns true once the golfer has
 * clearly left: off the course for `minMs`, or well away (`goneM`) on consecutive
 * fixes. Only after they've been on the course at all, so sharing from home before
 * a tee time never ends a round. `beenOn` seeds that (e.g. from the round's last fix).
 */
export function makeLeaveDetector({ offM = 350, minMs = 10 * 60000, goneM = 3000, goneFixes = 2 }: LeaveOptions = {}, beenOn = false) {
  let onCourse = beenOn, offSince: number | null = null, gone = 0;
  return function onFix(metres: number, t: number): boolean {
    if (metres <= ON_COURSE_M) onCourse = true;
    if (!onCourse) return false;
    gone = metres > goneM ? gone + 1 : 0;
    if (gone >= goneFixes) return true;
    if (metres <= offM) {
      offSince = null;
      return false;
    }
    offSince ??= t;
    return t - offSince >= minMs;
  };
}
