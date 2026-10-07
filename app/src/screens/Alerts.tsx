// Alerts: the bell on someone's page (what you want to hear about their rounds),
// a simple page for friends who aren't playing, your notifications list, and the
// banner that drops in when a new alert arrives. Alerts are made on the server
// (migration 12); the `push` Edge Function also sends them to iPhones (lib/push.ts).
import { useEffect, useRef, useState } from "react";
import { markNotesRead, removeWatch, saveWatch, type Note, type WatchSettings } from "../lib/db";
import type { LiveData } from "../lib/hooks";
import { describeNote, isOff, NO_ALERTS } from "../lib/notify";
import { SafetyActions } from "./Safety";
import { declinePush, enablePush, pushDeclined, pushPermission, type PushPermission } from "../lib/push";
import { ago } from "../lib/time";
import { Avatar } from "../components/Avatar";
import { untilText } from "./LocationSharing";
import { features } from "../lib/features";
import { friendlyError } from "../lib/errors";

const nameIn = (data: LiveData, id: string) => data.profiles.get(id)?.display_name || "Golfer";

/** The bell: choose what you hear about `golferId`'s rounds. Saves as you tap. */
export function AlertSettings({ data, me, golferId }: { data: LiveData; me: string; golferId: string }) {
  const saved = data.watches.find((w) => w.watcher_id === me && w.golfer_id === golferId);
  const [w, setW] = useState<WatchSettings>(saved ?? NO_ALERTS);
  const [err, setErr] = useState<string | null>(null);
  const modeOf = (x: WatchSettings): "off" | "every" | "pick" => (x.every_hole ? "every" : x.holes.length ? "pick" : "off");
  const [mode, setMode] = useState<"off" | "every" | "pick">(modeOf(saved ?? NO_ALERTS));
  const name = nameIn(data, golferId);

  // Taps update the screen at once and save in the background: one save at a time, the latest
  // settings win, and a failure puts the switches back to what's actually saved.
  const confirmed = useRef<WatchSettings>(saved ?? NO_ALERTS);
  const pending = useRef<WatchSettings | null>(null);
  const saving = useRef(false);
  async function flush() {
    if (saving.current) return;
    saving.current = true;
    while (pending.current) {
      const next = pending.current;
      pending.current = null;
      try {
        await (isOff(next) ? removeWatch(me, golferId) : saveWatch(golferId, next));
        confirmed.current = next;
      } catch (e) {
        if (!pending.current) (setW(confirmed.current), setMode(modeOf(confirmed.current)));
        setErr(friendlyError(e, "Couldn't save your alerts. Try again."));
      }
    }
    saving.current = false;
    data.reload();
  }
  function update(next: WatchSettings) {
    setW(next);
    setErr(null);
    pending.current = next;
    void flush();
  }
  const toggleHole = (h: number) => update({ ...w, every_hole: false, holes: w.holes.includes(h) ? w.holes.filter((x) => x !== h) : [...w.holes, h] });

  return (
    <div className="list alerts">
      <p className="note">Alerts about {name}'s rounds. You'll get these every time they play. {name} can see that you get updates.</p>
      {err && <p className="note err" role="alert">{err}</p>}
      {!isOff(w) && <PushOffer name={name} />}

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
    </div>
  );
}

/**
 * The phone's notification permission, explained before iOS asks (LAUNCH_GOAL step 3):
 * shown once someone has turned an alert on, never at first launch.
 */
function PushOffer({ name }: { name: string }) {
  const [perm, setPerm] = useState<PushPermission | null>(null);
  const [hidden, setHidden] = useState(pushDeclined);
  const [busy, setBusy] = useState(false);
  useEffect(() => void pushPermission().then(setPerm).catch(() => setPerm("unsupported")), []);
  if (perm === "denied")
    return <p className="note">Notifications are off for FairWhere. To get these on your lock screen, turn them on in iPhone Settings › FairWhere › Notifications.</p>;
  if (perm !== "prompt" || hidden) return null;
  return (
    <section className="card push-offer">
      <b>🔔 Get these on your lock screen?</b>
      <p className="note">FairWhere can send a notification for {name}'s alerts, even when the app is closed. Nothing else.</p>
      <div className="actions">
        <button className="btn" disabled={busy} onClick={async () => {
          setBusy(true);
          setPerm(await enablePush().catch(() => "denied" as const));
          setBusy(false);
        }}>Turn on notifications</button>
        <button className="btn ghost" onClick={() => (declinePush(), setHidden(true))}>Not now</button>
      </div>
    </section>
  );
}

/** Edit profile: the same permission, any time (e.g. after "Not now"). Hidden on the web. */
export function PushSetting() {
  const [perm, setPerm] = useState<PushPermission | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void pushPermission().then(setPerm).catch(() => setPerm("unsupported")), []);
  if (!perm || perm === "unsupported") return null;
  return (
    <div className="f push-setting">
      Lock-screen alerts
      {perm === "granted" ? (
        <span className="note">On. Alerts you set on a buddy's bell also arrive as notifications.</span>
      ) : perm === "denied" ? (
        <span className="note">Off in iPhone Settings › FairWhere › Notifications.</span>
      ) : (
        <button className="btn ghost" disabled={busy} onClick={async () => {
          setBusy(true);
          setPerm(await enablePush().catch(() => "denied" as const));
          setBusy(false);
        }}>Turn on notifications</button>
      )}
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
export function PersonCard({ data, me, id, onAlerts, onBlocked }: { data: LiveData; me: string; id: string; onAlerts: () => void; onBlocked: () => void }) {
  const p = data.profiles.get(id);
  const spot = data.spots.find((s) => s.user_id === id);
  const share = data.shares.find((s) => s.owner_id === id && s.viewer_id === me);
  const watching = data.watches.some((w) => w.watcher_id === me && w.golfer_id === id);
  return (
    <div className="list">
      <section className="card profile">
        <Avatar id={id} name={nameIn(data, id)} photo={p?.avatar_url} size={96} />
        <div className="person-head">
          <b>{nameIn(data, id)}</b>
          {p?.username && <span className="sub">@{p.username}</span>}
          <span className="sub">Not on the course right now</span>
          {features.everydayLocation && share && (
            <span className="spot-line">📍 Sharing their location with you {untilText(share.expires_at)}{spot ? ` · updated ${ago(Date.parse(spot.updated_at), Date.now())}` : " · no update yet"}</span>
          )}
        </div>
        <button className="btn" onClick={onAlerts}>{watching ? "🔔 Edit alerts" : "🔔 Get alerts when they play"}</button>
      </section>
      <SafetyActions target={id} name={p?.display_name || "this golfer"} onBlocked={onBlocked} />
    </div>
  );
}

/** Your alerts, newest first. Opening the list marks them read. */
export function Inbox({ data, onOpen }: { data: LiveData; onOpen: (n: Note) => void }) {
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
          <button key={n.id} className={`row-btn${n.read_at ? "" : " unread"}`} onClick={() => onOpen(n)}>
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
