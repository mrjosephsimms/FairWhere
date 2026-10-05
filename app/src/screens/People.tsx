// The "Buddies" panel (People.tsx): everyone you're connected with, Find My style. Anyone out on the
// course (or about to tee off) is at the top with a pulsing ring; everyone else is
// greyed out, A to Z. Tap someone with a round to see it (and play their holes).
import { useState } from "react";
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

export function People({ data, me, now, rounds, query, onOpen, onPerson, onAddPeople }: {
  data: LiveData;
  me: string;
  now: number;
  /** Already filtered by visibleRounds(). */
  rounds: Round[];
  /** Name / @username filter from the search box ("" = everyone). */
  query: string;
  onOpen: (roundId: string) => void;
  /** A friend who isn't playing (their page has the alert bell). */
  onPerson: (id: string) => void;
  onAddPeople: () => void;
}) {
  const nameOf = (id: string) => data.profiles.get(id)?.display_name || "Golfer";
  const friendIds = data.friendships
    .filter((f) => f.status === "accepted")
    .map((f) => (f.user_id === me ? f.friend_id : f.user_id));
  const requests = data.friendships.filter((f) => f.status === "pending" && f.friend_id === me).length;
  // Each friend's most relevant round: live beats finished.
  const roundOf = new Map<string, Round>();
  for (const r of rounds) if (r.user_id !== me && (!roundOf.has(r.user_id) || r.status === "live")) roundOf.set(r.user_id, r);

  const q = query.trim().toLowerCase().replace(/^@/, "");
  const matches = (id: string) => !q || nameOf(id).toLowerCase().includes(q) || (data.profiles.get(id)?.username ?? "").includes(q);
  const people = friendIds.filter(matches);
  const out = people.filter((id) => roundOf.get(id)?.status === "live").sort((a, b) => Date.parse(roundOf.get(a)!.tee_time) - Date.parse(roundOf.get(b)!.tee_time));
  const rest = people.filter((id) => roundOf.get(id)?.status !== "live").sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  if (!data.loaded) return <p className="empty">Loading…</p>;

  const row = (id: string, active: boolean) => {
    const r = roundOf.get(id);
    const p = data.profiles.get(id);
    const info = r ? roundInfo(r, data.courses.get(r.course_id), now) : null;
    if (!r || !info) {
      return (
        <button key={id} className="row-btn idle" onClick={() => onPerson(id)}>
          <Avatar id={id} name={nameOf(id)} photo={p?.avatar_url} />
          <span className="row-main">
            <b>{nameOf(id)}</b>
            <span className="sub">
              {data.spots.some((x) => x.user_id === id)
                ? `📍 Sharing location · ${ago(Date.parse(data.spots.find((x) => x.user_id === id)!.updated_at), now)}`
                : p?.username ? `@${p.username}` : "Not on the course"}
            </span>
          </span>
        </button>
      );
    }
    const { est, label, seq } = info;
    const chip = paceChip(est);
    const card = summarize(data.scores.get(r.id) ?? new Map(), seq.map((h) => h.par));
    const status =
      est.phase === "pre" ? `Tees off ${fmtTime(Date.parse(r.tee_time))}`
      : est.phase === "done" ? `Finished ${fmtTime(est.eta)}`
      : `Hole ${r.hole}`;
    return (
      <button key={id} className={`row-btn${active ? "" : " idle"}`} onClick={() => onOpen(r.id)}>
        <Avatar id={id} name={nameOf(id)} photo={p?.avatar_url} live={active} badge={est.phase === "live" ? String(r.hole) : undefined} />
        <span className="row-main">
          <b>{nameOf(id)}</b>
          <span className="sub mode-line">
            {active && <ModeIcon mode={r.mode} size={15} />}{status}
            {card.thru > 0 && <b className="score-chip">{fmtToPar(card.toPar)}</b>} · {label}
          </span>
          {r.searching_since && est.phase === "live" && (
            <span className="hunt-sm">🔎 Looking for a ball · {fmtDur(now - Date.parse(r.searching_since))}</span>
          )}
          {active && <span className="sub faint">Updated {ago(Date.parse(r.updated_at), now)}</span>}
        </span>
        {active && (
          <span className="row-end">
            <b className="time">{fmtTime(est.eta)}</b>
            <span className={`tone ${chip.tone}`}>{est.phase === "pre" ? "est. finish" : chip.label}</span>
          </span>
        )}
      </button>
    );
  };

  return (
    <>
      {requests > 0 && (
        <div className="rows">
          <button className="row-btn notice" onClick={onAddPeople}>
            <span className="notice-dot" aria-hidden>{requests}</span>
            <span className="row-main"><b>{requests === 1 ? "1 friend request" : `${requests} friend requests`}</b></span>
            <Chevron />
          </button>
        </div>
      )}
      {out.length > 0 && <div className="rows" aria-live="polite">{out.map((id) => row(id, true))}</div>}
      {rest.length > 0 && <div className="rows">{rest.map((id) => row(id, false))}</div>}
      {!friendIds.length && (
        <div className="empty">
          <b>No buddies yet</b>
          <span>Add your golf buddies (or whoever you're waiting on) to see which hole they're on.</span>
          <button className="btn" onClick={onAddPeople}>Add buddies</button>
        </div>
      )}
      {friendIds.length > 0 && !people.length && <p className="empty">No one matches “{query}”.</p>}
    </>
  );
}

/** One golfer's round, shown in the sheet while the map zooms to their course. */
export function RoundDetail({ round, data, me, now, onPlay }: { round: Round; data: LiveData; me: string; now: number; onPlay: (hole: number) => void }) {
  const [pick, setPick] = useState<number | null>(null);
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
      <HoleStrip round={round} now={now} scores={card.thru ? scores : undefined} pars={pars} selected={pick ?? undefined} onSelect={setPick} />
      {pick ? (
        <div className="play-card">
          <div>
            <b>Hole {pick}</b> · Par {pars[pick - 1]}{seq[pick - 1].yards ? ` · ${seq[pick - 1].yards} yds` : ""}
            <span className="sub">
              {scores.get(pick) != null
                ? `${round.user_id === me ? "You" : data.profiles.get(round.user_id)?.display_name || "Golfer"} made ${scores.get(pick)}. Can you beat it?`
                : "Not scored yet. Set the score to beat."}
            </span>
          </div>
          <button className="btn" onClick={() => onPlay(pick)}>🎮 Play hole {pick}</button>
        </div>
      ) : (
        <p className="note">🎮 Tap any hole to play it yourself and try to beat the score.</p>
      )}
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
