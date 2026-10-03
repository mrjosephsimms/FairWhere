// Shared round visuals: pace chip, 18-hole scorecard strip, and an SVG course map
// drawn from the hole centerlines (no map tiles needed). Ported from the prototype.
import { useMemo } from "react";
import type { PlayHole } from "../lib/courses";
import { paceChip, type PaceEstimate } from "../lib/pace";
import type { Round } from "../lib/db";

export function PaceChip({ est }: { est: PaceEstimate }) {
  const c = paceChip(est);
  return <span className={`pill ${c.tone}`}>{c.label}</span>;
}

export function HoleStrip({ round, now }: { round: Round; now: number }) {
  const done = round.status !== "live";
  const started = now >= Date.parse(round.tee_time);
  return (
    <div className="strip" aria-label={done ? "Round finished" : `Hole ${round.hole} of 18`}>
      {Array.from({ length: 18 }, (_, i) => {
        const n = i + 1;
        const cls = done || n < round.hole ? "done" : n === round.hole && started ? "now" : "";
        return (
          <i key={n} className={`${cls}${n === 10 ? " turn" : ""}`}>
            {n}
          </i>
        );
      })}
    </div>
  );
}

export function CourseMap({ seq, round, est }: { seq: PlayHole[]; round: Round; est: PaceEstimate }) {
  const geo = useMemo(() => {
    const pts = seq.flatMap((h) => h.centerline);
    const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const xs = pts.map((p) => p[1] * k), ys = pts.map((p) => -p[0]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY), pad = span * 0.08, S = 1000 / (span + 2 * pad);
    const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2;
    return (p: [number, number]): [number, number] => [(p[1] * k - ox) * S + 500, (-p[0] - oy) * S + 500];
  }, [seq]);

  const cur = round.status === "live" ? round.hole : 0;
  let dot: [number, number] | null = null;
  if (est.phase === "live") {
    const fresh = round.last_lat != null && round.last_lng != null && round.last_fix_at &&
      Date.now() - Date.parse(round.last_fix_at) < 15 * 60000;
    if (fresh) dot = geo([round.last_lat!, round.last_lng!]);
    else dot = alongLine(seq[cur - 1].centerline.map(geo), est.frac ?? 0);
  }

  return (
    <svg className="map" viewBox="0 0 1000 1000" role="img" aria-label={cur ? `Course map, hole ${cur}` : "Course map"}>
      {seq.map((h) => {
        const pts = h.centerline.map(geo);
        const on = h.n === cur, past = round.status !== "live" || h.n < cur;
        const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
        const g = pts[pts.length - 1], t = pts[0];
        return (
          <g key={h.n}>
            <path d={d} fill="none" stroke={on ? "var(--flag)" : past ? "var(--fairway)" : "var(--muted)"}
              strokeWidth={on ? 14 : 7} strokeLinecap="round" strokeLinejoin="round" opacity={on ? 1 : past ? 0.75 : 0.45} />
            <circle cx={g[0]} cy={g[1]} r={on ? 16 : 10} fill={on ? "var(--flag)" : "var(--fairway)"} />
            <text x={t[0]} y={t[1] - 14} className="map-num" fontSize={on ? 34 : 24} textAnchor="middle">{h.n}</text>
          </g>
        );
      })}
      {dot && <circle cx={dot[0]} cy={dot[1]} r={22} fill="var(--surface)" stroke="var(--flag)" strokeWidth={8} />}
    </svg>
  );
}

/** Point `f` (0..1) of the way along a polyline. */
function alongLine(pts: [number, number][], f: number): [number, number] {
  const segs = pts.slice(1).map((b, i) => {
    const a = pts[i];
    return { a, b, d: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  });
  let want = f * segs.reduce((s, x) => s + x.d, 0);
  for (const { a, b, d } of segs) {
    if (want <= d && d > 0) return [a[0] + ((b[0] - a[0]) * want) / d, a[1] + ((b[1] - a[1]) * want) / d];
    want -= d;
  }
  return pts[pts.length - 1];
}

export function StopConfirm({ busy, onYes, onNo }: { busy: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div className="confirm" role="alertdialog" aria-label="Stop sharing this round?">
      <b>Stop sharing this round?</b>
      <span className="note">It disappears from your friends' list right away.</span>
      <div className="actions">
        <button className="btn flag" disabled={busy} onClick={onYes}>Stop sharing</button>
        <button className="btn ghost" onClick={onNo}>Keep going</button>
      </div>
    </div>
  );
}
