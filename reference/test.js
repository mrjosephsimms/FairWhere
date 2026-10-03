// Run: node reference/test.js
const assert = require('assert');
const { estimate } = require('./pace');
const { detectHole, makeHoleTracker } = require('./holeDetect');
const data = require('../data/courses.json');

const redhawk = data.courses.find(c => c.id === 'redhawk');
const lines = redhawk.holes.map(h => h.centerline);
const pars = redhawk.holes.map(h => h.par);

// Pace: 150 min in, 5 min into hole 11, usual pace 4h15
const now = Date.now();
const est = estimate({ pars, teeTime: now - 150 * 60000, targetMinutes: 255, hole: 11, holeStartedAt: now - 5 * 60000, status: 'live' }, now);
const left = Math.round((est.eta - now) / 60000);
console.log('Hole 11 @ 2:30 elapsed -> minutes left:', left, 'delta:', Math.round(est.deltaMin));
assert(left > 80 && left < 140);

// Pre-round
assert.equal(estimate({ pars, teeTime: now + 60000, hole: 1, status: 'live' }, now).phase, 'pre');

// Detection: midpoint of hole 7's centerline should detect hole 7 when on 6 or 7
const mid = redhawk.holes[6].centerline[1];
assert.equal(detectHole(lines, mid, 6).hole, 7);
assert.equal(detectHole(lines, mid, 7).hole, 7);
// Far away -> null (off course)
assert.equal(detectHole(lines, [33.50, -117.15], 7), null);

// Debounce: needs 2 fixes to advance
const track = makeHoleTracker();
assert.equal(track(lines, mid, 6).change, false);
assert.equal(track(lines, mid, 6).change, true);

console.log('All reference tests passed.');
