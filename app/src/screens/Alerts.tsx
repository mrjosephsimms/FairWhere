// Alerts: the bell on someone's page (what you want to hear about their rounds),
// a simple page for friends who aren't playing, your notifications list, and the
// banner that drops in when a new alert arrives. Alerts are made on the server
// (migration 12); iPhone push will deliver the same ones later.
import { useEffect, useRef, useState } from "react";
import { markNotesRead, removeWatch, saveWatch, type Note, type WatchSettings } from "../lib/db";
import type { LiveData } from "../lib/hooks";
import { describeNote, isOff, NO_ALERTS } from "../lib/notify";
import { ago } from "../lib/time";
import { Avatar } from "../components/Avatar";

const nameIn = (data: LiveData, id: string) => data.profiles.get(id)?.display_name || "Golfer";

/** The bell: choose what you hear about `golferId`'s rounds. Saves as you tap. */
export function AlertSettings({ data, me, golferId }: { data: LiveData; me: string; golferId: string }) {
  const saved = data.watches.find((w) => w.watcher_id === me && w.golfer_id === golferId);
  const [w, setW] = useState<WatchSettings>(saved ?? NO_ALERTS);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"off" | "every" | "pick">(saved?.every_hole ? "every" : saved?.holes.length ? "pick" : "off");
  const name = nameIn(data, golferId);

  function update(next: WatchSettings) {
    setW(next);
    setErr(null);
    (isOff(next) ? removeWatch(me, golferId) : saveWatch(golferId, next)).then(data.reload).catch((e) => setErr(`Couldn't save: ${e.message}`));
  }
  const toggleHole = (h: number) => update({ ...w, every_hole: false, holes: w.holes.includes(h) ? w.holes.filter((x) => x !== h) : [...w.holes, h] });

  return (
    <div className="list alerts">
      <p className="note">Alerts about {name}'s rounds. You'll get these every time they play. {name} can see that you get updates.</p>

      <section className="card">
        <span className="label">Hole updates</span>
        <div className="segmented three">
          {(["off", "every", "pick"] as const).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} onClick={() => {
              setMode(m);
              update({ ...w, every_hole: m === "every", holes: m === "pick" ? (w.holes.length ? w.holes : [9, 18]) : [] });
            }}>
              {m === "off" ? "Off" : m === "every" ? "Every hole" : "Pick holes"}
            </button>
          ))}
        </div>
        {mode === "pick" && (
          <>
            <div className="presets">
              <button className="chip-btn" onClick={() => update({ ...w, every_hole: false, holes: [9] })}>The turn (9)</button>
              <button className="chip-btn" onClick={() => update({ ...w, every_hole: false, holes: [9, 18] })}>9 & 18</button>
              <button className="chip-btn" onClick={() => update({ ...w, every_hole: false, holes: [3, 6, 9, 12, 15, 18] })}>Every 3</button>
            </div>
            <div className="hole-picks">
              {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => (
                <button key={h} className={w.holes.includes(h) ? "on" : ""} aria-pressed={w.holes.includes(h)} onClick={() => toggleHole(h)}>{h}</button>
              ))}
            </div>
          </>
        )}
        <span className="note">"{name} finished hole 9 · on pace · done ~12:10"</span>
      </section>

      <section className="card">
        <span className="label">Before they finish</span>
        <div className="presets">
          {([null, 15, 30, 45, 60] as const).map((m) => (
            <button key={String(m)} className={`chip-btn${w.before_finish_min === m ? " on" : ""}`} aria-pressed={w.before_finish_min === m}
              onClick={() => update({ ...w, before_finish_min: m })}>
              {m ? `${m} min` : "Off"}
            </button>
          ))}
        </div>
        <span className="note">Handy for meeting them at the clubhouse or getting dinner going.</span>
      </section>

      <section className="card">
        <Switch label="Teed off" hint="When their round starts" on={w.tee_off} set={(v) => update({ ...w, tee_off: v })} />
        <Switch label="Finished" hint="With their score, if they keep one" on={w.finished} set={(v) => update({ ...w, finished: v })} />
        <Switch label="Ball hunt 🔎" hint="When they've been searching for a ball a few minutes" on={w.ball_hunt} set={(v) => update({ ...w, ball_hunt: v })} />
      </section>
      {err && <p className="note err" role="alert">{err}</p>}
    </div>
  );
}

function Switch({ label, hint, on, set }: { label: string; hint: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button className="switch-row" role="switch" aria-checked={on} onClick={() => set(!on)}>
      <span className="row-main"><b>{label}</b><span className="sub">{hint}</span></span>
      <span className={`switch${on ? " on" : ""}`} aria-hidden><i /></span>
    </button>
  );
}

/** A friend who isn't playing right now. */
export function PersonCard({ data, me, id, onAlerts }: { data: LiveData; me: string; id: string; onAlerts: () => void }) {
  const p = data.profiles.get(id);
  const watching = data.watches.some((w) => w.watcher_id === me && w.golfer_id === id);
  return (
    <div className="list">
      <section className="card profile">
        <Avatar id={id} name={nameIn(data, id)} photo={p?.avatar_url} size={96} />
        <div className="person-head">
          <b>{nameIn(data, id)}</b>
          {p?.username && <span className="sub">@{p.username}</span>}
          <span className="sub">Not on the course right now</span>
        </div>
        <button className="btn" onClick={onAlerts}>{watching ? "🔔 Edit alerts" : "🔔 Get alerts when they play"}</button>
      </section>
    </div>
  );
}

/** Your alerts, newest first. Opening the list marks them read. */
export function Inbox({ data, onOpen }: { data: LiveData; onOpen: (roundId: string) => void }) {
  // Keyed on the unread ids as a string so a fresh array each render doesn't re-run it.
  const unread = data.notes.filter((n) => !n.read_at).map((n) => n.id).join(",");
  const reload = data.reload;
  useEffect(() => {
    if (unread) markNotesRead(unread.split(",")).then(reload).catch(() => {});
  }, [unread, reload]);
  if (!data.notes.length)
    return (
      <div className="empty">
        <b>No alerts yet</b>
        <span>Open someone's page and tap the bell to get hole-by-hole updates, a heads-up before they finish, and more.</span>
      </div>
    );
  return (
    <div className="rows">
      {data.notes.map((n) => {
        const d = describeNote(n, nameIn(data, n.golfer_id));
        return (
          <button key={n.id} className={`row-btn${n.read_at ? "" : " unread"}`} onClick={() => onOpen(n.round_id)}>
            <Avatar id={n.golfer_id} name={nameIn(data, n.golfer_id)} photo={data.profiles.get(n.golfer_id)?.avatar_url} size={40} />
            <span className="row-main">
              <b className="note-title">{d.title}</b>
              {d.body && <span className="sub">{d.body}</span>}
              <span className="sub faint">{ago(Date.parse(n.created_at), Date.now())}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Drops in from the top for a few seconds when a new alert arrives. */
export function NoteBanner({ data, onOpen }: { data: LiveData; onOpen: (n: Note) => void }) {
  const seen = useRef<Set<string> | null>(null);
  const [show, setShow] = useState<Note | null>(null);
  useEffect(() => {
    if (!data.loaded) return;
    if (!seen.current) {
      seen.current = new Set(data.notes.map((n) => n.id)); // don't replay what was already there
      return;
    }
    const fresh = data.notes.find((n) => !seen.current!.has(n.id) && !n.read_at);
    data.notes.forEach((n) => seen.current!.add(n.id));
    if (!fresh) return;
    setShow(fresh);
    const t = setTimeout(() => setShow(null), 6000);
    return () => clearTimeout(t);
  }, [data.loaded, data.notes]);
  if (!show) return null;
  const d = describeNote(show, nameIn(data, show.golfer_id));
  return (
    <button className="note-banner" onClick={() => (setShow(null), onOpen(show))}>
      <Avatar id={show.golfer_id} name={nameIn(data, show.golfer_id)} photo={data.profiles.get(show.golfer_id)?.avatar_url} size={38} />
      <span className="row-main">
        <b>{d.title}</b>
        {d.body && <span className="sub">{d.body}</span>}
      </span>
    </button>
  );
}
