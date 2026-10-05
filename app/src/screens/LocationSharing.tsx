// Everyday location sharing settings (on your profile). Off by default: nobody sees
// where you are outside a round unless you pick them here, for a while or until you
// turn it off. You can also stop seeing someone who shares with you.
import { useState } from "react";
import { endShare, shareLocation } from "../lib/db";
import { useAction, type LiveData } from "../lib/hooks";
import { fmtTime } from "../lib/time";
import { isNative } from "../lib/native";

type Length = "hour" | "today" | "forever";
const LENGTHS: [Length, string][] = [["hour", "1 hour"], ["today", "Until end of day"], ["forever", "Until I turn it off"]];

function expiry(l: Length): Date | null {
  if (l === "hour") return new Date(Date.now() + 3600e3);
  if (l === "today") {
    const d = new Date();
    d.setHours(23, 59, 59, 0);
    return d;
  }
  return null;
}

export const untilText = (expires: string | null) => {
  if (!expires) return "until turned off";
  const d = new Date(expires);
  return d.toDateString() === new Date().toDateString() ? `until ${fmtTime(d.getTime())}` : `until ${d.toLocaleDateString([], { weekday: "short" })} ${fmtTime(d.getTime())}`;
};

export function LocationSharing({ data, me }: { data: LiveData; me: string }) {
  const { busy, err, run } = useAction(data.reload);
  const [picking, setPicking] = useState(false);
  const [who, setWho] = useState("");
  const [length, setLength] = useState<Length>("hour");
  const nameOf = (id: string) => data.profiles.get(id)?.display_name || "Golfer";
  const mine = data.shares.filter((s) => s.owner_id === me);
  const toMe = data.shares.filter((s) => s.viewer_id === me);
  const friends = data.friendships
    .filter((f) => f.status === "accepted")
    .map((f) => (f.user_id === me ? f.friend_id : f.user_id))
    .filter((id) => !mine.some((s) => s.viewer_id === id))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  return (
    <section className="card locshare">
      <span className="label">📍 Location sharing</span>
      {mine.length === 0 ? (
        <p className="note">Off. Nobody can see where you are outside a round. Round sharing works as usual.</p>
      ) : (
        mine.map((s) => (
          <div key={s.viewer_id} className="row-between">
            <span><b>{nameOf(s.viewer_id)}</b> <span className="sub">· {untilText(s.expires_at)}</span></span>
            <button className="btn ghost small" disabled={busy} onClick={() => run(() => endShare(me, s.viewer_id))}>Stop</button>
          </div>
        ))
      )}

      {picking ? (
        <div className="locshare-form">
          <label className="f">
            Share with
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Choose someone…</option>
              {friends.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
            </select>
          </label>
          <div className="presets">
            {LENGTHS.map(([l, label]) => (
              <button key={l} type="button" className={`chip-btn${length === l ? " on" : ""}`} aria-pressed={length === l} onClick={() => setLength(l)}>{label}</button>
            ))}
          </div>
          {who && <p className="note">{nameOf(who)} will see where you are, even away from the golf course.</p>}
          <div className="actions">
            <button className="btn" disabled={busy || !who} onClick={() => run(() => shareLocation(who, expiry(length))).then(() => (setPicking(false), setWho("")))}>Share</button>
            <button className="btn ghost" onClick={() => setPicking(false)}>Cancel</button>
          </div>
        </div>
      ) : friends.length > 0 ? (
        <button className="btn ghost" onClick={() => setPicking(true)}>Share my location…</button>
      ) : mine.length === 0 ? (
        <p className="note">Add people first to share your location with them.</p>
      ) : null}
      {mine.length > 0 && !isNative && <p className="note">On the web, your location updates while the app is open.</p>}

      {toMe.length > 0 && (
        <>
          <span className="label">Sharing with you</span>
          {toMe.map((s) => (
            <div key={s.owner_id} className="row-between">
              <span><b>{nameOf(s.owner_id)}</b> <span className="sub">· {untilText(s.expires_at)}</span></span>
              <button className="btn ghost small" disabled={busy} onClick={() => run(() => endShare(s.owner_id, me))}>Stop seeing</button>
            </div>
          ))}
        </>
      )}
      {err && <p className="note err" role="alert">{err}</p>}
    </section>
  );
}
