// Tee Tracker — pace / finish-time model (reference implementation, pure functions).
// Ported from the working prototype. Times are epoch ms; durations in minutes.

// Relative time weight per par. A par 5 takes ~1.22x a par 4, a par 3 ~0.78x.
const PAR_WEIGHT = { 3: 0.78, 4: 1.0, 5: 1.22 };

/** Split a target round time (minutes) across holes by par weight. */
function allocate(pars, targetMinutes) {
  const total = pars.reduce((s, p) => s + PAR_WEIGHT[p], 0);
  return pars.map(p => (targetMinutes * PAR_WEIGHT[p]) / total);
}

/**
 * @param {object} round
 *   pars:          number[18]  par of each hole in play order
 *   teeTime:       ms
 *   targetMinutes: usual round length (default 255 = 4h15)
 *   hole:          current hole 1..18
 *   holeStartedAt: ms when the golfer reached the current hole
 *   holeFraction:  optional 0..1 progress along the hole from GPS (overrides time-based guess)
 *   status:        'live' | 'done';  finishedAt: ms when done
 * @param {number} now ms
 * @returns {{phase:'pre'|'live'|'done', eta:number, deltaMin:number, frac?:number}}
 *   deltaMin > 0 means behind the golfer's usual pace, < 0 ahead.
 */
function estimate(round, now) {
  const a = allocate(round.pars, round.targetMinutes || 255);
  const total = a.reduce((x, y) => x + y, 0);
  const tee = round.teeTime;

  if (round.status === 'done')
    return { phase: 'done', eta: round.finishedAt, deltaMin: (round.finishedAt - tee) / 60000 - total };
  if (now < tee)
    return { phase: 'pre', eta: tee + total * 60000, deltaMin: 0 };

  const h = Math.min(Math.max(round.hole || 1, 1), 18);
  const before = a.slice(0, h - 1).reduce((x, y) => x + y, 0);
  const onHoleMin = Math.max(0, (now - (round.holeStartedAt || tee)) / 60000);
  // Never assume the hole is more than 90% done from time alone.
  const frac = round.holeFraction != null ? round.holeFraction : Math.min(onHoleMin / a[h - 1], 0.9);
  const expected = before + frac * a[h - 1];         // minutes a usual-pace golfer would have used by now
  const elapsed = (now - tee) / 60000;
  // Pace factor: how much slower/faster than usual. Ignore the first ~20 min (noise), clamp outliers.
  let p = expected > 20 ? elapsed / expected : 1;
  p = Math.min(Math.max(p, 0.8), 1.5);
  const remaining = (total - expected) * p;
  return { phase: 'live', eta: now + remaining * 60000, deltaMin: elapsed - expected, frac };
}

module.exports = { PAR_WEIGHT, allocate, estimate };
