import { useEffect, useState, type FormEvent } from "react";
import { removeFriendship, requestFriend, respondFriend, setDisplayName, type Friendship } from "../lib/db";
import { useAction, type LiveData } from "../lib/hooks";
import { shareInvite } from "../lib/native";
import { supabase } from "../lib/supabase";

export function Me({ data, me, incomingCode, onCodeUsed }: {
  data: LiveData;
  me: string;
  incomingCode: string | null;
  onCodeUsed: () => void;
}) {
  const profile = data.profiles.get(me);
  const nameOf = (id: string) => data.profiles.get(id)?.display_name || "Golfer";
  const other = (f: Friendship) => (f.user_id === me ? f.friend_id : f.user_id);
  const accepted = data.friendships.filter((f) => f.status === "accepted");
  const incoming = data.friendships.filter((f) => f.status === "pending" && f.friend_id === me);
  const outgoing = data.friendships.filter((f) => f.status === "pending" && f.user_id === me);

  const { busy, err, run } = useAction(data.reload);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  useEffect(() => setName(profile?.display_name ?? ""), [profile?.display_name]);
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
      setMsg(status === "accepted" ? "You're now friends." : "Request sent. They'll show up once they accept.");
    });
  }

  return (
    <div className="list">
      <section className="card">
        <label className="f">
          Your name (what friends see)
          <div className="inline">
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            <button className="btn ghost" disabled={busy || !name.trim() || name.trim() === profile?.display_name}
              onClick={() => run(() => setDisplayName(me, name))}>Save</button>
          </div>
        </label>
        <div>
          <span className="label">Your friend code</span>
          <div className="code">{profile?.friend_code ?? "······"}</div>
        </div>
        <button className="btn" disabled={!profile}
          onClick={async () => setMsg((await shareInvite(profile!.friend_code, profile!.display_name)) === "copied" ? "Invite copied." : null)}>
          Invite a friend
        </button>
      </section>

      <form className="card" onSubmit={add}>
        <label className="f">
          Add a friend by code
          <div className="inline">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6}
              autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="ABC234" className="mono" />
            <button className="btn" disabled={busy || code.trim().length !== 6}>Add</button>
          </div>
        </label>
        {msg && <p className="note">{msg}</p>}
        {err && <p className="note err" role="alert">{err}</p>}
      </form>

      {incoming.length > 0 && (
        <section className="card">
          <span className="label">Requests</span>
          {incoming.map((f) => (
            <div className="row" key={f.user_id}>
              <span className="who">{nameOf(f.user_id)}</span>
              <div className="actions tight">
                <button className="btn" disabled={busy} onClick={() => run(() => respondFriend(f.user_id, true))}>Accept</button>
                <button className="btn ghost" disabled={busy} onClick={() => run(() => respondFriend(f.user_id, false))}>Decline</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <span className="label">Friends</span>
        {accepted.length === 0 && <p className="note">No friends yet. Share your code, or add theirs above.</p>}
        {accepted.map((f) => (
          <div key={other(f)}>
            <div className="row">
              <span className="who">{nameOf(other(f))}</span>
              <button className="btn ghost small" onClick={() => setConfirmRemove(other(f))}>Remove</button>
            </div>
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
          <div className="row" key={f.friend_id}>
            <span className="who muted">{nameOf(f.friend_id)} <small>· waiting</small></span>
            <button className="btn ghost small" disabled={busy} onClick={() => run(() => removeFriendship(f))}>Cancel</button>
          </div>
        ))}
      </section>

      <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      <p className="note center">Course data © OpenStreetMap contributors (ODbL) · Map © OpenFreeMap</p>
    </div>
  );
}
