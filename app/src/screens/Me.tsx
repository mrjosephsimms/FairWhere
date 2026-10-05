// Me: your profile. Photo, name and @username (friends see the photo), your stats
// (only here, only for you), and an expandable round history.
import { useEffect, useMemo, useRef, useState } from "react";
import { playSequence, type CourseData } from "../lib/courses";
import { getCourses, getMyHistory, setAvatar, setDisplayName, setUsername, USERNAME_RE, type GamePlay, type Round } from "../lib/db";
import { useAction, type LiveData } from "../lib/hooks";
import { profileStats } from "../lib/stats";
import { fmtToPar, summarize } from "../lib/score";
import { fmtDur } from "../lib/time";
import { resizeToJpeg } from "../lib/image";
import { supabase } from "../lib/supabase";
import { Avatar } from "../components/Avatar";
import { HoleStrip } from "../components/RoundView";
import { ModeIcon } from "../components/ModeIcon";
import { LocationSharing } from "./LocationSharing";

interface History {
  rounds: Round[];
  scores: Map<string, Map<number, number>>;
  plays: GamePlay[];
  courses: Map<string, CourseData>;
}

export function Me({ data, me, now }: { data: LiveData; me: string; now: number }) {
  const [hist, setHist] = useState<History | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);
  // Refresh history when one of your rounds changes state (e.g. you just finished).
  const mine = data.rounds.filter((r) => r.user_id === me).map((r) => `${r.id}:${r.status}`).join(",");
  useEffect(() => {
    getMyHistory(me)
      .then(async (h) => setHist({ ...h, courses: new Map(await getCourses(h.rounds.map((r) => r.course_id))) }))
      .catch((e) => setHistErr(e.message));
  }, [me, mine]);

  const parsOf = useMemo(() => {
    const cache = new Map<string, number[] | null>();
    return (r: Round) => {
      if (!cache.has(r.id)) {
        const c = hist?.courses.get(r.course_id);
        let pars: number[] | null = null;
        try {
          pars = c ? playSequence(c, r.nines).map((h) => h.par) : null;
        } catch {
          pars = null;
        }
        cache.set(r.id, pars);
      }
      return cache.get(r.id)!;
    };
  }, [hist]);
  const stats = useMemo(() => (hist ? profileStats(hist.rounds, hist.scores, parsOf, hist.plays) : null), [hist, parsOf]);
  const courseName = (id: string | null) => (id ? hist?.courses.get(id)?.name ?? id : "—");

  return (
    <div className="list">
      <ProfileCard data={data} me={me} />
      <LocationSharing data={data} me={me} />

      {histErr && <p className="note err">Couldn't load your stats: {histErr}</p>}
      {stats && (
        <section className="card">
          <span className="label">Your golf</span>
          <div className="stat-grid">
            <Stat label="Rounds" value={stats.rounds} />
            <Stat label="Holes played" value={stats.holes} />
            <Stat label="Hours out there" value={stats.hoursOnCourse ? stats.hoursOnCourse.toFixed(stats.hoursOnCourse < 10 ? 1 : 0) : 0} />
            <Stat label="Average score" value={stats.avgScore != null ? Math.round(stats.avgScore) : "—"} />
            <Stat label="Best round" value={stats.bestRound ? stats.bestRound.strokes : "—"} sub={stats.bestRound ? fmtToPar(stats.bestRound.toPar) : undefined} />
            <Stat label={stats.birdies === 1 ? "Birdie" : "Birdies"} value={stats.birdies} sub={`${stats.pars} par${stats.pars === 1 ? "" : "s"}`} />
            <Stat label="Average round" value={stats.avgMinutes != null ? fmtDur(stats.avgMinutes * 60000) : "—"} />
            <Stat label="Fastest round" value={stats.fastestMinutes != null ? fmtDur(stats.fastestMinutes * 60000) : "—"} />
            <Stat label="Hole game" value={`${stats.gameWins}/${stats.gamePlays}`} sub="wins / plays" />
          </div>
          {stats.favoriteCourse && <p className="note">Home course: <b>{courseName(stats.favoriteCourse)}</b></p>}
        </section>
      )}

      {hist && <RoundHistory hist={hist} parsOf={parsOf} now={now} />}

      <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      <p className="note center">Course data © OpenStreetMap contributors (ODbL) · Map © OpenFreeMap</p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="stat-cell">
      <b>{value}</b>
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/** Photo (tap to change), display name, and the unique @username. */
function ProfileCard({ data, me }: { data: LiveData; me: string }) {
  const profile = data.profiles.get(me);
  const { busy, err, run } = useAction(data.reload);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setName(profile?.display_name ?? ""), [profile?.display_name]);
  useEffect(() => setHandle(profile?.username ?? ""), [profile?.username]);

  const cleanHandle = handle.trim().replace(/^@/, "").toLowerCase();
  const handleOk = USERNAME_RE.test(cleanHandle);

  async function pick(f: File | undefined) {
    if (!f) return;
    setUploading(true);
    await run(async () => setAvatar(me, await resizeToJpeg(f)));
    setUploading(false);
  }

  return (
    <section className="card profile">
      <button className="profile-photo" onClick={() => file.current?.click()} aria-label="Change profile photo" disabled={uploading}>
        <Avatar id={me} name={profile?.display_name || "Me"} photo={profile?.avatar_url} size={96} />
        <span className="profile-cam" aria-hidden>{uploading ? "…" : "📷"}</span>
      </button>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <div className="profile-fields">
        <label className="f">
          Name
          <div className="inline">
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            <button className="btn ghost" disabled={busy || !name.trim() || name.trim() === profile?.display_name}
              onClick={() => run(() => setDisplayName(me, name))}>Save</button>
          </div>
        </label>
        <label className="f">
          Username {profile?.username ? "" : <em className="nudge">· pick one so friends can find you</em>}
          <div className="inline">
            <span className="at-input">
              <span aria-hidden>@</span>
              <input value={handle.replace(/^@/, "")} maxLength={20} autoCapitalize="none" autoCorrect="off" spellCheck={false}
                placeholder="yourname" onChange={(e) => setHandle(e.target.value.toLowerCase())} />
            </span>
            <button className="btn ghost" disabled={busy || !handleOk || cleanHandle === profile?.username}
              onClick={() => run(() => setUsername(me, cleanHandle))}>Save</button>
          </div>
          {handle && !handleOk && <span className="note">3–20 characters: letters, numbers, _ or .</span>}
        </label>
      </div>
      {err && <p className="note err" role="alert">{err}</p>}
    </section>
  );
}

/** Expandable list of your past rounds; tap one to see its scorecard. */
function RoundHistory({ hist, parsOf, now }: { hist: History; parsOf: (r: Round) => number[] | null; now: number }) {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<string | null>(null);
  const rounds = hist.rounds.filter((r) => r.status === "done" || r.status === "cancelled");
  return (
    <section className="card history">
      <button className="history-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="label">Round history</span>
        <span className="sub">{rounds.length ? `${rounds.length} round${rounds.length === 1 ? "" : "s"}` : "None yet"}</span>
        <svg className={`chev${open ? " up" : ""}`} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && rounds.map((r) => {
        const pars = parsOf(r);
        const scores = hist.scores.get(r.id) ?? new Map<number, number>();
        const sum = pars ? summarize(scores, pars) : null;
        const mins = r.finished_at ? (Date.parse(r.finished_at) - Date.parse(r.tee_time)) / 60000 : null;
        const date = new Date(r.tee_time).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
        return (
          <div key={r.id} className="history-row">
            <button className="history-btn" onClick={() => setCard(card === r.id ? null : r.id)} aria-expanded={card === r.id}>
              <span className="row-main">
                <b>{hist.courses.get(r.course_id)?.name ?? r.course_id}</b>
                <span className="sub mode-line"><ModeIcon mode={r.mode} size={14} /> {date}{mins && mins > 0 && mins < 720 ? ` · ${fmtDur(mins * 60000)}` : ""}</span>
              </span>
              <span className="row-end">
                {sum && sum.thru > 0 ? (
                  <><b className="time">{sum.strokes}</b><span className="tone">{sum.thru === 18 ? fmtToPar(sum.toPar) : `thru ${sum.thru}`}</span></>
                ) : (
                  <span className="sub">{r.status === "cancelled" ? "Stopped" : `${r.hole} hole${r.hole === 1 ? "" : "s"}`}</span>
                )}
              </span>
            </button>
            {card === r.id && pars && <HoleStrip round={r} now={now} scores={scores} pars={pars} />}
          </div>
        );
      })}
    </section>
  );
}
