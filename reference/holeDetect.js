// Tee Tracker — GPS → current hole detection (reference implementation, pure functions).
// Course data: data/courses.json (hole centerlines tee→green as [lat, lng] arrays).

const R = 6371000;
const rad = d => (d * Math.PI) / 180;

/** Metres between two [lat, lng] points (equirectangular; accurate at course scale). */
function distM(a, b) {
  const la = rad((a[0] + b[0]) / 2);
  return Math.hypot(rad(b[1] - a[1]) * Math.cos(la) * R, rad(b[0] - a[0]) * R);
}

/** Closest point on a polyline: distance (m) and fraction (0..1) along its length. */
function nearestOnLine(line, pt) {
  let best = null, run = 0;
  const lens = [];
  for (let j = 1; j < line.length; j++) lens.push(distM(line[j - 1], line[j]));
  const total = lens.reduce((s, x) => s + x, 0) || 1;
  for (let j = 1; j < line.length; j++) {
    const a = line[j - 1], b = line[j], k = Math.cos(rad(a[0]));
    const ax = a[1] * k, ay = a[0], bx = b[1] * k, by = b[0], px = pt[1] * k, py = pt[0];
    const den = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / den));
    const proj = [ay + (by - ay) * t, (ax + (bx - ax) * t) / k];
    const d = distM(pt, proj);
    if (!best || d < best.d) best = { d, frac: (run + lens[j - 1] * t) / total };
    run += lens[j - 1];
  }
  return best;
}

/**
 * Candidate hole for a GPS fix. Only looks at holes near the current one
 * (current-2 .. current+2) so crossing an adjacent fairway doesn't jump the round.
 * @param {Array<Array<[number,number]>>} lines centerlines in play order (index 0 = hole 1)
 * @returns {{hole:number, d:number, frac:number} | null}  null if > offCourseM from all candidates
 */
function detectHole(lines, pt, currentHole, offCourseM = 120) {
  let best = null;
  for (let i = Math.max(0, currentHole - 3); i < Math.min(lines.length, currentHole + 2); i++) {
    const r = nearestOnLine(lines[i], pt);
    if (!best || r.d < best.d) best = { hole: i + 1, d: r.d, frac: r.frac };
  }
  return best && best.d <= offCourseM ? best : null;
}

/**
 * Debouncer: only advance when the same new hole is seen on N consecutive fixes,
 * and never move backwards automatically (golfer can correct manually).
 */
function makeHoleTracker({ confirmFixes = 2 } = {}) {
  let last = { hole: 0, count: 0 };
  return function onFix(lines, pt, currentHole) {
    const hit = detectHole(lines, pt, currentHole);
    if (!hit) return { change: false, offCourse: true };
    last = hit.hole === last.hole ? { hole: hit.hole, count: last.count + 1 } : { hole: hit.hole, count: 1 };
    const change = last.count >= confirmFixes && hit.hole > currentHole;
    return { change, hole: change ? hit.hole : currentHole, frac: hit.hole === currentHole ? hit.frac : 0, d: hit.d };
  };
}

module.exports = { distM, nearestOnLine, detectHole, makeHoleTracker };
