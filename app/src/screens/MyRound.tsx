import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { CourseData } from "../lib/courses";
import { endRound, getScores, listCourses, setHole, setScore, startRound, type Round } from "../lib/db";
import { fmtToPar, summarize } from "../lib/score";
import { isOff, summarizeWatch } from "../lib/notify";
import { DEFAULT_TARGET, type Mode } from "../lib/pace";
import { ModeIcon } from "../components/ModeIcon";
import { toYards } from "../lib/onCourse";
import { AWAY_FROM_COURSE_M, metresFromCourse } from "../lib/leaveCourse";
import type { LatLng } from "../lib/courses";
import type { GpsState } from "../lib/tracker";
import { fmtDur } from "../lib/time";
import { useAction, type LiveData } from "../lib/hooks";
import { roundInfo } from "../lib/roundInfo";
import { fmtTime, nextTeeSlot, teeTimeFromInput, toTimeInput } from "../lib/time";
import { HoleStrip, PaceChip, StopConfirm } from "../components/RoundView";

const PACES = [
  [210, "3h 30m"],
  [225, "3h 45m"],
  [240, "4h 00m"],
  [255, "4h 15m"],
  [270, "4h 30m"],
  [285, "4h 45m"],
  [300, "5h 00m"],
] as const;

const MODES: [Mode, string][] = [["riding", "Riding"], ["walking", "Walking"]];

export function MyRound({ data, me, now, gps }: { data: LiveData; me: string; now: number; gps: GpsState }) {
  const live = data.rounds.find((r) => r.user_id === me && r.status === "live");
  if (live) return <LiveRound round={live} data={data} now={now} gps={gps} />;
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
  const [mode, setModeState] = useState<Mode>("riding");
  const [target, setTarget] = useState(DEFAULT_TARGET.riding);
  const [paceTouched, setPaceTouched] = useState(false);
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

  const [checking, setChecking] = useState(false);
  const [away, setAway] = useState<number | null>(null); // metres from the course, when they seem not to be there

  async function submit(e: FormEvent, anyway = false) {
    e.preventDefault();
    if (!course || ninesBad || selectedEmpty) return;
    if (!anyway) {
      // Not at the course? Ask first (they may be sharing ahead of a later tee time).
      setChecking(true);
      const here = await currentPosition();
      setChecking(false);
      const m = here ? metresFromCourse(course, here) : 0;
      if (m > AWAY_FROM_COURSE_M) return setAway(m);
    }
    setAway(null);
    run(() =>
      startRound({
        course_id: course.id,
        nines: course.nines ? [front, back] : null,
        tee_time: teeTimeFromInput(tee, new Date()),
        target_minutes: target,
        mode,
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
          Usual pace ({mode})
          <select value={target} onChange={(e) => (setTarget(Number(e.target.value)), setPaceTouched(true))}>
            {PACES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <div className="segmented" role="radiogroup" aria-label="Walking or riding">
        {MODES.map(([m, label]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => {
            setModeState(m);
            if (!paceTouched) setTarget(DEFAULT_TARGET[m]); // follow the mode until they pick a pace
          }}>
            <ModeIcon mode={m} /> {label}
          </button>
        ))}
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
      {away != null ? (
        <div className="confirm" role="alertdialog" aria-label="Not at a golf course?">
          <b>Hey, it doesn't look like you're at a golf course.</b>
          <span className="note">You're about {fmtDistance(away)} from {course?.name}. Start sharing your round anyway?</span>
          <div className="actions">
            <button type="button" className="btn" disabled={busy} onClick={(e) => submit(e, true)}>Start anyway</button>
            <button type="button" className="btn ghost" onClick={() => setAway(null)}>Not yet</button>
          </div>
        </div>
      ) : (
        <button className="btn" disabled={busy || checking || ninesBad || selectedEmpty}>{checking ? "Checking where you are…" : "Start sharing my round"}</button>
      )}
      <p className="note">Friends see your hole, tee time and estimated finish. Sharing stops when you finish.</p>
      {err && <p className="note err" role="alert">{err}</p>}
    </form>
  );
}

function LiveRound({ round, data, now, gps }: { round: Round; data: LiveData; now: number; gps: GpsState }) {
  const [confirmStop, setConfirmStop] = useState(false);
  const { busy, err, run } = useAction(data.reload);
  const info = roundInfo(round, data.courses.get(round.course_id), now);
  if (!info) return <div className="card empty">Loading course…</div>;
  const { est, hole, label, seq } = info;
  const go = (n: number) => n >= 1 && n <= 18 && n !== round.hole && run(() => setHole(round.id, n));

  return (
    <>
    <div className="card">
      <div className="row">
        <div className="course mode-line"><ModeIcon mode={round.mode} size={16} /> {label}</div>
        <PaceChip est={est} />
      </div>

      <div className="stats">
        <div className="stat">
          <span className="label">{est.phase === "pre" ? `Tees off ${fmtTime(Date.parse(round.tee_time))}` : "On hole"}</span>
          <b>{round.hole}<small>/18</small></b>
          <span className="sub">Par {hole.par}{hole.yards ? ` · ${hole.yards} yds` : ""}</span>
        </div>
        <div className="stat">
          <span className="label">To the green</span>
          {gps.pos ? <b>{toYards(gps.pos.toGreenM)}<small>yds</small></b> : <b className="dim">—</b>}
          <span className="sub">{gpsLine(gps)}</span>
        </div>
      </div>
      {gps.pos && (
        <div className="progress" aria-label={`${Math.round(gps.pos.frac * 100)}% of the hole`}>
          <i style={{ width: `${Math.round(gps.pos.frac * 100)}%` }} />
          <span>{Math.round(gps.pos.frac * 100)}% of the hole · {toYards(gps.pos.fromTeeM)} yds from the tee</span>
        </div>
      )}
      {gps.searchingSince && <p className="hunt">🔎 Ball hunt? {fmtDur(now - gps.searchingSince)} in this spot. Your friends can see it.</p>}
      <p className="note">Finish around <b>{fmtTime(est.eta)}</b></p>
      <div className="stepper">
        <button className="btn ghost" aria-label="Back one hole" disabled={busy || round.hole <= 1} onClick={() => go(round.hole - 1)}>−</button>
        {round.hole < 18 ? (
          <button className="btn" disabled={busy} onClick={() => go(round.hole + 1)}>On to hole {round.hole + 1}</button>
        ) : (
          <button className="btn flag" disabled={busy} onClick={() => run(() => endRound(round.id, "done"))}>Finish round</button>
        )}
        <button className="btn ghost" aria-label="Forward one hole" disabled={busy || round.hole >= 18} onClick={() => go(round.hole + 1)}>+</button>
      </div>
    </div>
    <ScoreCard round={round} now={now} pars={seq.map((h) => h.par)} data={data} />
    <Watchers data={data} golfer={round.user_id} />
    <div className="list">
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
    </>
  );
}

/** Your scorecard: a big -/+ pad for the selected hole, the running total, and the nine pills as the card. */
function ScoreCard({ round, now, pars, data }: { round: Round; now: number; pars: number[]; data: LiveData }) {
  const [scores, setScores] = useState<Map<number, number>>(new Map());
  const [sel, setSel] = useState(round.hole);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setSel(round.hole), [round.hole]); // follow the golfer to each new hole
  useEffect(() => {
    getScores(round.id).then(setScores).catch((e) => setErr(e.message));
  }, [round.id]);

  const par = pars[sel - 1];
  const val = scores.get(sel);
  const sum = summarize(scores, pars);
  function save(n: number) {
    const strokes = Math.min(Math.max(n, 1), 20), prev = scores;
    setScores(new Map(scores).set(sel, strokes)); // optimistic
    setErr(null);
    setScore(round.id, sel, strokes).catch((e) => (setScores(prev), setErr(`Couldn't save that score: ${e.message}`)));
  }

  return (
    <section className="card scorecard" aria-label="Scorecard">
      <div className="row-between">
        <span className="label">Score</span>
        <span className="score-total">
          {sum.thru ? <><b>{fmtToPar(sum.toPar)}</b> · {sum.strokes} thru {sum.thru}</> : "Tap the number for par"}
        </span>
      </div>
      <div className="score-pad">
        <button className="pad-btn" aria-label="One fewer stroke" onClick={() => save((val ?? par) - 1)}>−</button>
        <button className={`pad-val${val == null ? " unset" : ""}`} onClick={() => val == null && save(par)}
          aria-label={val == null ? `Hole ${sel}: tap to enter par` : `Hole ${sel}: ${val} strokes`}>
          <b>{val ?? par}</b>
          <span>Hole {sel} · Par {par}</span>
        </button>
        <button className="pad-btn" aria-label="One more stroke" onClick={() => save((val ?? par) + 1)}>+</button>
      </div>
      <HoleStrip round={round} now={now} scores={scores} pars={pars} selected={sel} onSelect={setSel} />
      <Challengers round={round} scores={scores} data={data} />
      {err && <p className="note err" role="alert">{err}</p>}
    </section>
  );
}

function gpsLine(gps: GpsState): string {
  if (gps.status === "asking") return "Finding you…";
  if (gps.status === "denied") return "Location is off; use the buttons";
  if (gps.status === "unavailable") return "No GPS on this device";
  if (gps.status === "on" && !gps.pos) return "Off the course";
  return gps.fix ? `GPS ±${Math.round(gps.fix.acc)} m` : "";
}

/**
 * One quiet line about friends playing your holes at home (no alerts, by design):
 * "🎮 Mary played 3 of your holes · beat you on 1".
 */
function Challengers({ round, scores, data }: { round: Round; scores: Map<number, number>; data: LiveData }) {
  const plays = data.plays.filter((p) => p.round_id === round.id && p.player_id !== round.user_id);
  if (!plays.length) return null;
  const players = [...new Set(plays.map((p) => p.player_id))];
  const holes = new Set(plays.map((p) => p.hole)).size;
  const beat = new Set(plays.filter((p) => scores.has(p.hole) && p.strokes < scores.get(p.hole)!).map((p) => p.hole)).size;
  const who = players.length === 1 ? data.profiles.get(players[0])?.display_name || "A friend" : `${players.length} friends`;
  return (
    <p className="challengers">
      🎮 {who} played {holes === 1 ? "1 of your holes" : `${holes} of your holes`}{beat ? ` · beat you on ${beat}` : ""}
    </p>
  );
}

/** Who gets alerts about your rounds (shown so sharing is never a surprise). */
function Watchers({ data, golfer }: { data: LiveData; golfer: string }) {
  const watchers = data.watches.filter((w) => w.golfer_id === golfer && !isOff(w));
  if (!watchers.length) return null;
  return (
    <section className="card watchers">
      <span className="label">🔔 Getting updates</span>
      {watchers.map((w) => (
        <p key={w.watcher_id} className="note">
          <b>{data.profiles.get(w.watcher_id)?.display_name || "A friend"}</b>: {summarizeWatch(w)}
        </p>
      ))}
    </section>
  );
}

/** One quick GPS reading for the "are you at the course?" check; null if unavailable or refused. */
function currentPosition(): Promise<LatLng | null> {
  return new Promise((ok) => {
    if (!("geolocation" in navigator)) return ok(null);
    navigator.geolocation.getCurrentPosition(
      (p) => ok([p.coords.latitude, p.coords.longitude]),
      () => ok(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
    );
  });
}

const fmtDistance = (m: number) => (m < 1609 ? `${Math.round(m / 10) * 10} m` : `${Math.round(m / 1609.34)} mi`);

