// Shared round visuals: pace chip, 18-hole scorecard strip, stop confirmation.
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
