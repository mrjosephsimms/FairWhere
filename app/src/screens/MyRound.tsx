import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { CourseData } from "../lib/courses";
import { endRound, listCourses, setHole, startRound, type Round } from "../lib/db";
import { useAction, type LiveData } from "../lib/hooks";
import { roundInfo } from "../lib/roundInfo";
import { fmtTime, nextTeeSlot, teeTimeFromInput, toTimeInput } from "../lib/time";
import { HoleStrip, PaceChip, StopConfirm } from "../components/RoundView";

const PACES = [
  [225, "3h 45m"],
  [240, "4h 00m"],
  [255, "4h 15m"],
  [270, "4h 30m"],
  [285, "4h 45m"],
] as const;

export function MyRound({ data, me, now }: { data: LiveData; me: string; now: number }) {
  const live = data.rounds.find((r) => r.user_id === me && r.status === "live");
  if (live) return <LiveRound round={live} data={data} now={now} />;
  const last = data.rounds.find((r) => r.user_id === me && r.status === "done");
  return (
    <>
      {last?.finished_at && (
        <p className="note">Last round finished at {fmtTime(Date.parse(last.finished_at))}. Friends can see it until 4 hours after.</p>
      )}
      <StartRoundForm data={data} me={me} />
    </>
  );
}

function StartRoundForm({ data, me }: { data: LiveData; me: string }) {
  const [courses, setCourses] = useState<CourseData[] | null>(null);
  const [courseId, setCourseId] = useState("");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [tee, setTee] = useState(() => toTimeInput(nextTeeSlot(new Date())));
  const [target, setTarget] = useState(255);
  const [visibility, setVisibility] = useState<"friends" | "selected">("friends");
  const [viewers, setViewers] = useState<Set<string>>(new Set());
  const { busy, err, run } = useAction(data.reload);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    listCourses()
      .then((cs) => {
        setCourses(cs);
        if (cs[0]) setCourseId(cs[0].id);
      })
      .catch((e) => setLoadErr(e.message));
  }, []);

  const course = courses?.find((c) => c.id === courseId);
  useEffect(() => {
    if (course?.nines) {
      setFront(course.nines[0]);
      setBack(course.nines[1]);
    }
  }, [course]);

  const friends = useMemo(
    () =>
      data.friendships
        .filter((f) => f.status === "accepted")
        .map((f) => (f.user_id === me ? f.friend_id : f.user_id))
        .map((id) => ({ id, name: data.profiles.get(id)?.display_name || "Golfer" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data, me],
  );

  const ninesBad = Boolean(course?.nines && front === back);
  const selectedEmpty = visibility === "selected" && viewers.size === 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!course || ninesBad || selectedEmpty) return;
    run(() =>
      startRound({
        course_id: course.id,
        nines: course.nines ? [front, back] : null,
        tee_time: teeTimeFromInput(tee, new Date()),
        target_minutes: target,
        visibility,
        viewers: [...viewers],
      }),
    );
  }

  if (loadErr) return <p className="note err">Couldn't load courses: {loadErr}</p>;
  if (!courses) return <div className="card empty">Loading courses…</div>;

  return (
    <form className="card" onSubmit={submit}>
      <label className="f">
        Course
        <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.nines ? ` (${c.nines.length * 9} holes)` : ""}</option>
          ))}
        </select>
      </label>
      {course?.nines && (
        <div className="two">
          <label className="f">
            Front nine
            <select value={front} onChange={(e) => setFront(e.target.value)}>
              {course.nines.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <label className="f">
            Back nine
            <select value={back} onChange={(e) => setBack(e.target.value)}>
              {course.nines.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        </div>
      )}
      {ninesBad && <p className="note err">Pick two different nines.</p>}
      <div className="two">
        <label className="f">
          Tee time
          <input type="time" value={tee} onChange={(e) => setTee(e.target.value)} required />
        </label>
        <label className="f">
          Usual pace
          <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
            {PACES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="f">
        <legend>Who can see it</legend>
        <div className="seg">
          <label><input type="radio" checked={visibility === "friends"} onChange={() => setVisibility("friends")} /> All friends</label>
          <label><input type="radio" checked={visibility === "selected"} onChange={() => setVisibility("selected")} /> Selected</label>
        </div>
        {visibility === "selected" &&
          (friends.length ? (
            <div className="checks">
              {friends.map((f) => (
                <label key={f.id}>
                  <input type="checkbox" checked={viewers.has(f.id)} onChange={(e) => {
                    const next = new Set(viewers);
                    if (e.target.checked) next.add(f.id);
                    else next.delete(f.id);
                    setViewers(next);
                  }} />
                  {f.name}
                </label>
              ))}
            </div>
          ) : (
            <p className="note">You haven't added any friends yet.</p>
          ))}
      </fieldset>
      <button className="btn" disabled={busy || ninesBad || selectedEmpty}>Start sharing my round</button>
      <p className="note">Friends see your hole, tee time and estimated finish. Sharing stops when you finish.</p>
      {err && <p className="note err" role="alert">{err}</p>}
    </form>
  );
}

function LiveRound({ round, data, now }: { round: Round; data: LiveData; now: number }) {
  const [confirmStop, setConfirmStop] = useState(false);
  const { busy, err, run } = useAction(data.reload);
  const info = roundInfo(round, data.courses.get(round.course_id), now);
  if (!info) return <div className="card empty">Loading course…</div>;
  const { est, hole, label } = info;
  const go = (n: number) => n >= 1 && n <= 18 && n !== round.hole && run(() => setHole(round.id, n));

  return (
    <div className="card">
      <div className="row">
        <div className="course">{label}</div>
        <PaceChip est={est} />
      </div>
      <div className="big">
        <span className="label">{est.phase === "pre" ? `Tees off ${fmtTime(Date.parse(round.tee_time))}` : "On hole"}</span>
        <div className="hole">{round.hole}</div>
        <div className="note">
          Par {hole.par}{hole.yards ? ` · ${hole.yards} yds` : ""} · finish around <b>{fmtTime(est.eta)}</b>
        </div>
      </div>
      <div className="stepper">
        <button className="btn ghost" aria-label="Back one hole" disabled={busy || round.hole <= 1} onClick={() => go(round.hole - 1)}>−</button>
        {round.hole < 18 ? (
          <button className="btn" disabled={busy} onClick={() => go(round.hole + 1)}>Walking to {round.hole + 1}</button>
        ) : (
          <button className="btn flag" disabled={busy} onClick={() => run(() => endRound(round.id, "done"))}>Finish round</button>
        )}
        <button className="btn ghost" aria-label="Forward one hole" disabled={busy || round.hole >= 18} onClick={() => go(round.hole + 1)}>+</button>
      </div>
      <HoleStrip round={round} now={now} />
      <div className="actions">
        {round.hole < 18 && (
          <button className="btn ghost" disabled={busy} onClick={() => run(() => endRound(round.id, "done"))}>Finish early</button>
        )}
        <button className="btn ghost" onClick={() => setConfirmStop(true)}>Stop sharing</button>
      </div>
      {confirmStop && (
        <StopConfirm busy={busy} onYes={() => run(() => endRound(round.id, "cancelled"))} onNo={() => setConfirmStop(false)} />
      )}
      {err && <p className="note err" role="alert">{err}</p>}
    </div>
  );
}
