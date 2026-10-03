// Where a golfer is on the hole they're playing, and the "ball hunt" detector.
// Pure and tested; fed by the live GPS hook (lib/tracker.ts).
import type { LatLng, PlayHole } from "./courses";
import { distM, nearestOnLine } from "./holeDetect";

export const toYards = (m: number) => Math.round(m * 1.09361);

/** Roughly half a fairway: further than this from the centerline counts as off the fairway. */
export const FAIRWAY_HALF_WIDTH_M = 20;
/** Lingering this close to a tee or green is normal (waiting, putting), never a ball hunt. */
const TEE_ZONE_M = 30, GREEN_ZONE_M = 35;

export interface HolePosition {
  /** Metres to the middle of the green (the pin position isn't in the course data). */
  toGreenM: number;
  fromTeeM: number;
  /** 0..1 along the tee->green centerline. */
  frac: number;
  /** Metres off the centerline. */
  lateralM: number;
  offFairway: boolean;
  nearTeeOrGreen: boolean;
}

export function locateOnHole(hole: PlayHole, pt: LatLng): HolePosition {
  const line = hole.centerline;
  const green = hole.green?.center ?? line[line.length - 1];
  const { d, frac } = nearestOnLine(line, pt);
  const toGreenM = distM(pt, green), fromTeeM = distM(pt, line[0]);
  const nearTeeOrGreen = fromTeeM <= TEE_ZONE_M || toGreenM <= GREEN_ZONE_M;
  return { toGreenM, fromTeeM, frac, lateralM: d, offFairway: d > FAIRWAY_HALF_WIDTH_M, nearTeeOrGreen };
}

export interface SearchOptions {
  /** Staying inside this radius counts as "in one spot". */
  radiusM?: number;
  /** How long in one spot off the fairway before we call it a ball hunt. */
  minMs?: number;
}

/**
 * Ball-hunt detector. Feed it every fix; it returns when the current hunt started
 * (epoch ms) once the golfer has stayed within `radiusM` of one spot off the fairway,
 * away from tees and greens, for `minMs`. Otherwise null. Moving on resets it.
 */
export function makeSearchDetector({ radiusM = 25, minMs = 3 * 60000 }: SearchOptions = {}) {
  let anchor: { pt: LatLng; t: number } | null = null;
  return function onFix(pt: LatLng, t: number, pos: Pick<HolePosition, "offFairway" | "nearTeeOrGreen"> | null): number | null {
    if (!pos || !pos.offFairway || pos.nearTeeOrGreen) {
      anchor = null;
      return null;
    }
    if (!anchor || distM(anchor.pt, pt) > radiusM) {
      anchor = { pt, t };
      return null;
    }
    return t - anchor.t >= minMs ? anchor.t : null;
  };
}
