// "Add buddies" (the + on Buddies): your @username / code to share, add someone by
// @username or code, answer requests, manage who you're connected with.
import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { removeFriendship, requestFriend, respondFriend, type Friendship } from "../lib/db";
import { useAction, type LiveData } from "../lib/hooks";
import { addLink, shareInvite, shareProfile } from "../lib/native";
import { Avatar } from "../components/Avatar";

export function AddPeople({ data, me, incomingCode, onCodeUsed }: {
  data: LiveData;
  me: string;
  incomingCode: string | null;
  onCodeUsed: () => void;
}) {
  const profile = data.profiles.get(me);
  const nameOf = (id: string) => data.profiles.get(id)?.display_name || "Golfer";
  const handleOf = (id: string) => data.profiles.get(id)?.username;
  const other = (f: Friendship) => (f.user_id === me ? f.friend_id : f.user_id);
  const accepted = data.friendships.filter((f) => f.status === "accepted").sort((a, b) => nameOf(other(a)).localeCompare(nameOf(other(b))));
  const incoming = data.friendships.filter((f) => f.status === "pending" && f.friend_id === me);
  const outgoing = data.friendships.filter((f) => f.status === "pending" && f.user_id === me);

  const { busy, err, run } = useAction(data.reload);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  useEffect(() => {
    if (incomingCode) {
      setCode(incomingCode);
      onCodeUsed();
    }
  }, [incomingCode, onCodeUsed]);

  function add(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    run(async () => {
      const status = await requestFriend(code);
      setCode("");
      setMsg(status === "accepted" ? "You're now connected." : "Request sent. They'll show up once they accept.");
    });
  }

  const person = (id: string, extra?: React.ReactNode) => (
    <div className="person">
      <Avatar id={id} name={nameOf(id)} photo={data.profiles.get(id)?.avatar_url} size={40} />
      <span className="row-main">
        <b>{nameOf(id)}</b>
        {handleOf(id) && <span className="sub">@{handleOf(id)}</span>}
      </span>
      {extra}
    </div>
  );

  return (
    <div className="list">
      <form className="card" onSubmit={add}>
        <label className="f">
          Add by @username or code
          <div className="inline">
            <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={21}
              autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="@username or ABC234" />
            <button className="btn" disabled={busy || code.trim().replace(/^@/, "").length < 3}>Add</button>
          </div>
        </label>
        {msg && <p className="note">{msg}</p>}
        {err && <p className="note err" role="alert">{err}</p>}
      </form>

      {profile && <ShareYours code={profile.friend_code} name={profile.display_name} username={profile.username} onMsg={setMsg} />}

      {incoming.length > 0 && (
        <section className="card">
          <span className="label">Requests</span>
          {incoming.map((f) => (
            <div key={f.user_id}>
              {person(f.user_id,
                <div className="actions tight">
                  <button className="btn" disabled={busy} onClick={() => run(() => respondFriend(f.user_id, true))}>Accept</button>
                  <button className="btn ghost" disabled={busy} onClick={() => run(() => respondFriend(f.user_id, false))}>Decline</button>
                </div>)}
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <span className="label">Your buddies</span>
        {accepted.length === 0 && outgoing.length === 0 && <p className="note">No buddies yet. Add someone above, or share yours.</p>}
        {accepted.map((f) => (
          <div key={other(f)}>
            {person(other(f), <button className="btn ghost small" onClick={() => setConfirmRemove(other(f))}>Remove</button>)}
            {confirmRemove === other(f) && (
              <div className="confirm">
                <b>Remove {nameOf(other(f))}?</b>
                <span className="note">You'll stop seeing each other's rounds.</span>
                <div className="actions">
                  <button className="btn flag" disabled={busy} onClick={() => run(() => removeFriendship(f)).then(() => setConfirmRemove(null))}>Remove</button>
                  <button className="btn ghost" onClick={() => setConfirmRemove(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {outgoing.map((f) => (
          <div key={f.friend_id}>
            {person(f.friend_id, <button className="btn ghost small" disabled={busy} onClick={() => run(() => removeFriendship(f))}>Cancel request</button>)}
          </div>
        ))}
      </section>
    </div>
  );
}

/** Your code or a QR code (any phone camera opens it), plus share-by-text buttons. */
function ShareYours({ code, name, username, onMsg }: { code: string; name: string; username: string | null; onMsg: (m: string | null) => void }) {
  const [view, setView] = useState<"code" | "qr">("code");
  const [qr, setQr] = useState<string | null>(null);
  const link = addLink(code);
  useEffect(() => {
    if (view !== "qr") return;
    QRCode.toDataURL(link, { width: 480, margin: 1, color: { dark: "#14321f", light: "#ffffff" } }).then(setQr).catch(() => setQr(null));
  }, [view, link]);
  const copied = (r: Awaited<ReturnType<typeof shareInvite>>) =>
    onMsg(r === "copied" ? "Copied. Paste it into a text." : r === "failed" ? `Couldn't open sharing here. Send them this: ${link}` : null);

  return (
    <section className="card share">
      <div className="row-between">
        <span className="label">Share yours</span>
        <div className="segmented mini" role="radiogroup" aria-label="Show code or QR">
          <button role="radio" aria-checked={view === "code"} onClick={() => setView("code")}>Code</button>
          <button role="radio" aria-checked={view === "qr"} onClick={() => setView("qr")}>QR</button>
        </div>
      </div>
      {view === "code" ? (
        <div className="share-ids">
          {username && <b>@{username}</b>}
          <span className="code">{code}</span>
        </div>
      ) : (
        <div className="qr">
          {qr ? <img src={qr} alt={`QR code to add ${name}`} width={200} height={200} /> : <div className="qr-wait" />}
          <span className="note">Scan with any phone camera to add {username ? `@${username}` : "you"}.</span>
        </div>
      )}
      <div className="actions">
        <button className="btn" onClick={async () => copied(await shareInvite(code, name))}>Send invite</button>
        <button className="btn ghost" onClick={async () => copied(await shareProfile(code, name, username))}>Share profile</button>
      </div>
      <span className="note">Invite: your code and a sign-up link. Profile: your name and @username.</span>
    </section>
  );
}

