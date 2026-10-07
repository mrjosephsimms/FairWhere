// Safety and account controls App Review requires (docs/LAUNCH_GOAL.md step 4): report or block
// someone (from their page), your blocked list (Edit profile), delete your account and the About
// links (Me).
import { useEffect, useState } from "react";
import { blockUser, deleteMyAccount, listBlocks, reportUser, unblockUser, type Blocked, type ReportReason } from "../lib/db";
import { LINKS, openLink } from "../lib/native";
import { supabase } from "../lib/supabase";
import { friendlyError } from "../lib/errors";

const REASONS: [ReportReason, string][] = [
  ["photo", "Inappropriate photo"],
  ["name", "Offensive name"],
  ["harassment", "Harassment"],
  ["spam", "Spam or fake account"],
  ["other", "Something else"],
];

/** Bottom of someone's page: report them, block them, or both. `onBlocked` closes their page. */
export function SafetyActions({ target, name, onBlocked }: { target: string; name: string; onBlocked: () => void }) {
  const [mode, setMode] = useState<"closed" | "report" | "block" | "sent">("closed");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function act(fn: () => Promise<void>, after: () => void) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      after();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  if (mode === "closed")
    return (
      <div className="safety-links">
        <button className="link" onClick={() => setMode("report")}>Report {name}</button>
        <span aria-hidden>·</span>
        <button className="link" onClick={() => setMode("block")}>Block</button>
      </div>
    );
  if (mode === "sent")
    return <p className="note center-text">Thanks. We'll look at this within 24 hours.</p>;
  if (mode === "block")
    return (
      <section className="card safety">
        <b>Block {name}?</b>
        <p className="note">You'll disappear for each other: no rounds, alerts or location either way, and they can't add you again. They aren't told.</p>
        <div className="actions">
          <button className="btn flag" disabled={busy} onClick={() => act(() => blockUser(target), onBlocked)}>Block</button>
          <button className="btn ghost" onClick={() => setMode("closed")}>Cancel</button>
        </div>
        {err && <p className="note err" role="alert">{err}</p>}
      </section>
    );
  return (
    <section className="card safety">
      <b>Report {name}</b>
      <div className="presets" role="radiogroup" aria-label="Reason">
        {REASONS.map(([r, label]) => (
          <button key={r} type="button" role="radio" aria-checked={reason === r} className={`chip-btn${reason === r ? " on" : ""}`} onClick={() => setReason(r)}>{label}</button>
        ))}
      </div>
      <label className="f">
        Anything else? (optional)
        <textarea rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} /> Also block {name}
      </label>
      <div className="actions">
        <button className="btn flag" disabled={busy || !reason} onClick={() => act(() => reportUser(target, reason!, details, alsoBlock), () => (alsoBlock ? onBlocked() : setMode("sent")))}>
          Send report
        </button>
        <button className="btn ghost" onClick={() => setMode("closed")}>Cancel</button>
      </div>
      {err && <p className="note err" role="alert">{err}</p>}
    </section>
  );
}

/** Edit profile: people you've blocked, with Unblock. */
export function BlockedList({ me }: { me: string }) {
  const [list, setList] = useState<Blocked[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => listBlocks().then(setList).catch(() => setList([]));
  const unblock = (id: string) => {
    setBusyId(id);
    setErr(null);
    unblockUser(me, id)
      .then(load)
      .catch((e) => setErr(friendlyError(e, "Couldn't unblock. Try again.")))
      .finally(() => setBusyId(null));
  };
  useEffect(() => void load(), []);
  if (!list?.length) return null;
  return (
    <div className="f">
      Blocked
      {list.map((b) => (
        <div key={b.id} className="row-between">
          <span>{b.display_name || "Golfer"}{b.username ? <span className="sub"> @{b.username}</span> : null}</span>
          <button className="btn ghost small" disabled={busyId != null} onClick={() => unblock(b.id)}>{busyId === b.id ? "…" : "Unblock"}</button>
        </div>
      ))}
      <span className="note">Unblocking doesn't make you buddies again; either of you can send a new request.</span>
      {err && <span className="note err" role="alert">{err}</span>}
    </div>
  );
}

/** Me: delete the account for good (Apple 5.1.1(v)). */
export function DeleteAccount({ me }: { me: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button className="link danger center" onClick={() => setOpen(true)}>Delete account</button>;
  return (
    <section className="card safety">
      <b>Delete your account?</b>
      <p className="note">This permanently deletes your profile, photo, rounds, scores, buddies and alerts. It can't be undone.</p>
      <div className="actions">
        <button className="btn flag" disabled={busy} onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await deleteMyAccount(me); // also removes this phone's push registration
            await supabase.auth.signOut();
          } catch (e) {
            setErr(friendlyError(e, "Couldn't delete your account. Check your connection and try again."));
            setBusy(false);
          }
        }}>{busy ? "Deleting…" : "Delete everything"}</button>
        <button className="btn ghost" disabled={busy} onClick={() => setOpen(false)}>Keep my account</button>
      </div>
      {err && <p className="note err" role="alert">{err}</p>}
    </section>
  );
}

/** Me: legal links and credits (OpenStreetMap's ODbL needs attribution). */
export function About() {
  return (
    <footer className="about">
      <div className="about-links">
        <button className="link" onClick={() => openLink(LINKS.privacy)}>Privacy</button>
        <span aria-hidden>·</span>
        <button className="link" onClick={() => openLink(LINKS.terms)}>Terms</button>
        <span aria-hidden>·</span>
        <button className="link" onClick={() => openLink(LINKS.support)}>Support</button>
      </div>
      <p className="note center">
        Course data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> (ODbL) ·
        Maps © OpenFreeMap, OpenMapTiles · Satellite © Esri
      </p>
      <p className="note center">FairWhere · Sunny Simms Inc.</p>
    </footer>
  );
}
