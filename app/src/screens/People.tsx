// The "People" panel: everyone you follow, Find My style. Tap a row for their round.
import type { LiveData } from "../lib/hooks";
import type { Round } from "../lib/db";
import { roundInfo } from "../lib/roundInfo";
import { paceChip } from "../lib/pace";
import { ago, fmtDur, fmtTime } from "../lib/time";
import { FIX_FRESH_MS } from "../lib/geo";
import { locateOnHole, toYards } from "../lib/onCourse";
import { fmtToPar, summarize } from "../lib/score";
import { Avatar } from "../components/Avatar";
import { HoleStrip, PaceChip } from "../components/RoundView";
import { ModeIcon } from "../components/ModeIcon";

export function People({ data, me, now, rounds, onOpen, onAddFriends }: {
  data: LiveData;
  me: string;
  now: number;
  /** Already filtered by visibleRounds(). */
  rounds: Round[];
  onOpen: (roundId: string) => void;
  onAddFriends: () => void;
}) {
  const nameOf = (id: string) => (id === me ? "You" : data.profiles.get(id)?.display_name || "Golfer");
  const friendIds = data.friendships
    .filter((f) => f.status === "accepted")
    .map((f) => (f.user_id === me ? f.friend_id : f.user_id));
  const out = new Set(rounds.map((r) => r.user_id));
  const idle = friendIds.filter((id) => !out.has(id)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const requests = data.friendships.filter((f) => f.status === "pending" && f.friend_id === me).length;

  if (!data.loaded) return <p className="empty">Loading…</p>;

  return (
    <div className="rows" aria-live="polite">
      {requests > 0 && (
        <button className="row-btn notice" onClick={onAddFriends}>
          <span className="notice-dot" aria-hidden>{requests}</span>
          <span className="row-main"><b>{requests === 1 ? "1 friend request" : `${requests} friend requests`}</b></span>
          <Chevron />
        </button>
      )}
      {rounds.map((r) => {
        const info = roundInfo(r, data.courses.get(r.course_id), now);
        if (!info) return null;
        const { est, label, seq } = info;
        const chip = paceChip(est);
        const card = summarize(data.scores.get(r.id) ?? new Map(), seq.map((h) => h.par));
        const status =
          est.phase === "pre" ? `Tees off ${fmtTime(Date.parse(r.tee_time))}`
          : est.phase === "done" ? `Finished ${fmtTime(est.eta)}`
          : `Hole ${r.hole}`;
        return (
          <button key={r.id} className="row-btn" onClick={() => onOpen(r.id)}>
            <Avatar id={r.user_id} name={data.profiles.get(r.user_id)?.display_name || "Golfer"} me={r.user_id === me} badge={est.phase === "live" ? String(r.hole) : undefined} />
            <span className="row-main">
              <b>{nameOf(r.user_id)}</b>
              <span className="sub mode-line">
                {est.phase !== "done" && <ModeIcon mode={r.mode} size={15} />}{status}
                {card.thru > 0 && <b className="score-chip">{fmtToPar(card.toPar)}</b>} · {label}
              </span>
              {r.searching_since && est.phase === "live" && (
                <span className="hunt-sm">🔎 Looking for a ball · {fmtDur(now - Date.parse(r.searching_since))}</span>
              )}
              <span className="sub faint">Updated {ago(Date.parse(r.updated_at), now)}</span>
            </span>
            <span className="row-end">
              {est.phase === "done" ? (
                <span className="sub">Done</span>
              ) : (
                <>
                  <b className="time">{fmtTime(est.eta)}</b>
                  <span className={`tone ${chip.tone}`}>{est.phase === "pre" ? "est. finish" : chip.label}</span>
                </>
              )}
            </span>
          </button>
        );
      })}
      {idle.map((id) => (
        <div key={id} className="row-btn static">
          <Avatar id={id} name={nameOf(id)} />
          <span className="row-main">
            <b>{nameOf(id)}</b>
            <span className="sub">Not on the course</span>
          </span>
        </div>
      ))}
      {!rounds.length && !idle.length && (
        <div className="empty">
          <b>Nobody here yet</b>
          <span>Add friends to see which hole they're on and when they'll be done.</span>
          <button className="btn" onClick={onAddFriends}>Add friends</button>
        </div>
      )}
    </div>
  );
}

/** One golfer's round, shown in the sheet while the map zooms to their course. */
export function RoundDetail({ round, data, me, now }: { round: Round; data: LiveData; me: string; now: number }) {
  const info = roundInfo(round, data.courses.get(round.course_id), now);
  if (!info) return <p className="empty">Loading course…</p>;
  const { est, hole, label, seq } = info;
  const pars = seq.map((h) => h.par);
  const scores = data.scores.get(round.id) ?? new Map<number, number>();
  const card = summarize(scores, pars);
  const fresh = est.phase === "live" && round.last_lat != null && round.last_lng != null && round.last_fix_at != null &&
    now - Date.parse(round.last_fix_at) < FIX_FRESH_MS;
  const toGreen = fresh ? toYards(locateOnHole(hole, [round.last_lat!, round.last_lng!]).toGreenM) : null;
  return (
    <div className="detail">
      <p className="sub mode-line"><ModeIcon mode={round.mode} size={16} /> {label}</p>
      <div className="stats">
        <div className="stat">
          <span className="label">{est.phase === "pre" ? "Tee time" : est.phase === "done" ? "Last hole" : "On hole"}</span>
          {est.phase === "pre" ? <b>{fmtTime(Date.parse(round.tee_time))}</b> : <b>{round.hole}<small>/18</small></b>}
          {est.phase === "live" && (
            <span className="sub">{toGreen != null ? `~${toGreen} yds to the green` : `Par ${hole.par}${hole.yards ? ` · ${hole.yards} yds` : ""}`}</span>
          )}
        </div>
        <div className="stat">
          <span className="label">{est.phase === "done" ? "Finished" : "Est. finish"}</span>
          <b>{fmtTime(est.eta)}</b>
          {est.phase === "live" && <span className="sub">About {fmtDur(est.eta - now)} left</span>}
        </div>
      </div>
      {round.searching_since && est.phase === "live" && (
        <p className="hunt">🔎 Looking for a ball? Same spot off the fairway for {fmtDur(now - Date.parse(round.searching_since))}.</p>
      )}
      <div className="row-between">
        <PaceChip est={est} />
        <span className="sub faint">Updated {ago(Date.parse(round.updated_at), now)}</span>
      </div>
      {card.thru > 0 && (
        <div className="row-between">
          <span className="label">Score</span>
          <span className="score-total"><b>{fmtToPar(card.toPar)}</b> · {card.strokes} thru {card.thru}</span>
        </div>
      )}
      <HoleStrip round={round} now={now} scores={card.thru ? scores : undefined} pars={pars} />
      <p className="sub">
        {est.phase === "pre" ? "Tees off" : "Teed off"} {fmtTime(Date.parse(round.tee_time))}
        {round.user_id === me ? " · this is your round" : ""}
      </p>
    </div>
  );
}

export function Chevron() {
  return (
    <svg className="chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
