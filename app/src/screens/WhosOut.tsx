import { useState } from "react";
import type { LiveData } from "../lib/hooks";
import { roundInfo } from "../lib/roundInfo";
import { ago, fmtDur, fmtTime } from "../lib/time";
import { CourseMap, HoleStrip, PaceChip } from "../components/RoundView";

export function WhosOut({ data, me, now, onAddFriends }: { data: LiveData; me: string; now: number; onAddFriends: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const hasFriends = data.friendships.some((f) => f.status === "accepted");
  // Mirrors the server's visibility window so a round drops off on time even without a refetch.
  const rounds = data.rounds
    .filter((r) =>
      r.status === "live"
        ? now - Date.parse(r.updated_at) < 6 * 3600e3
        : r.status === "done" && r.finished_at != null && now - Date.parse(r.finished_at) < 4 * 3600e3,
    )
    .sort((a, b) => Number(a.status !== "live") - Number(b.status !== "live") || Date.parse(a.tee_time) - Date.parse(b.tee_time));

  if (!data.loaded) return <div className="card empty">Loading…</div>;
  if (!rounds.length)
    return (
      <div className="card empty">
        <strong>Nobody's on the course right now</strong>
        {hasFriends ? (
          "When a friend starts a round, their hole and finish time show up here."
        ) : (
          <>
            Add friends to see their rounds here.
            <button className="btn ghost" onClick={onAddFriends}>Add friends</button>
          </>
        )}
      </div>
    );

  return (
    <div className="list" aria-live="polite">
      {rounds.map((r) => {
        const info = roundInfo(r, data.courses.get(r.course_id), now);
        const name = r.user_id === me ? "You" : data.profiles.get(r.user_id)?.display_name || "Golfer";
        if (!info) return null;
        const { est, hole, label } = info;
        const expanded = open === r.id;
        const toggle = () => setOpen(expanded ? null : r.id);
        return (
          <article key={r.id} className="card tap" tabIndex={0} aria-expanded={expanded} onClick={toggle}
            onKeyDown={(e) => e.key === "Enter" && toggle()}>
            <div className="row">
              <div>
                <div className="who">{name}</div>
                <div className="course">{label}</div>
              </div>
              <PaceChip est={est} />
            </div>
            <div className="row">
              {est.phase === "pre" ? (
                <div className="hole">{fmtTime(Date.parse(r.tee_time))}<small>tee time</small></div>
              ) : est.phase === "done" ? (
                <div className="hole">{r.hole}<small>{r.hole === 18 ? "done" : "stopped early"}</small></div>
              ) : (
                <div className="hole">{r.hole}<small>par {hole.par}{hole.yards ? ` · ${hole.yards} yds` : ""}</small></div>
              )}
              <div className="eta">
                <span className="label">{est.phase === "done" ? "Finished" : "Est. finish"}</span>
                <b>{fmtTime(est.eta)}</b>
              </div>
            </div>
            <HoleStrip round={r} now={now} />
            <div className="meta">
              <span>{est.phase === "pre" ? "Tees off" : "Teed off"} <b>{fmtTime(Date.parse(r.tee_time))}</b></span>
              {est.phase === "live" && <span>About <b>{fmtDur(est.eta - now)}</b> left</span>}
              <span>Updated {ago(Date.parse(r.updated_at), now)}</span>
            </div>
            {expanded && <CourseMap seq={info.seq} round={r} est={est} />}
          </article>
        );
      })}
    </div>
  );
}
