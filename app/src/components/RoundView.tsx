// Shared round visuals: pace chip, front/back nine hole strip, stop confirmation.
import { useEffect, useState } from "react";
import { paceChip, type PaceEstimate } from "../lib/pace";
import { holeResult } from "../lib/score";
import type { Round } from "../lib/db";

export function PaceChip({ est }: { est: PaceEstimate }) {
  const c = paceChip(est);
  return <span className={`pill ${c.tone}`}>{c.label}</span>;
}

/**
 * Nine pills at a time: the nine they're on, with a Front 9 / Back 9 switch to peek at
 * the other. With `scores`, the pills become the scorecard: tap one to pick that hole.
 */
export function HoleStrip({ round, now, scores, pars, selected, onSelect }: {
  round: Round;
  now: number;
  scores?: Map<number, number>;
  pars?: number[];
  selected?: number;
  onSelect?: (hole: number) => void;
}) {
  const done = round.status !== "live";
  const started = now >= Date.parse(round.tee_time);
  const onBack = done || round.hole > 9;
  const focusBack = selected != null ? selected > 9 : onBack;
  const [back, setBack] = useState(focusBack);
  useEffect(() => setBack(focusBack), [focusBack]); // follow them (or the picked hole) through the turn
  const holes = Array.from({ length: 9 }, (_, i) => (back ? 10 : 1) + i);
  return (
    <div className="nine">
      <div className="nine-switch" role="tablist" aria-label="Which nine">
        {[false, true].map((b) => (
          <button key={String(b)} role="tab" aria-selected={back === b} onClick={() => setBack(b)}>
            {b ? "Back 9" : "Front 9"}
            {b === onBack && !done && <i className="nine-dot" aria-hidden />}
          </button>
        ))}
      </div>
      <div className="strip" aria-label={done ? "Round finished" : `Hole ${round.hole} of 18`}>
        {holes.map((n) => {
          const cls = `${done || n < round.hole ? "done" : n === round.hole && started ? "now" : ""}${selected === n ? " sel" : ""}`;
          return onSelect ? (
            <button key={n} className={cls} aria-pressed={selected === n} aria-label={`Hole ${n}`} onClick={() => onSelect(n)}>{n}</button>
          ) : (
            <i key={n} className={cls}>{n}</i>
          );
        })}
      </div>
      {scores && pars && (
        <div className="strip scores" aria-hidden>
          {holes.map((n) => {
            const s = scores.get(n);
            return <span key={n} className={s ? holeResult(s, pars[n - 1]) : ""}>{s ?? "·"}</span>;
          })}
        </div>
      )}
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
