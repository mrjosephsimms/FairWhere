// First run (docs/LAUNCH_GOAL.md step 5): you → how location is used → notifications → your first
// buddy → start a round. Every step can be skipped; closing the app resumes at the same step.
import { useEffect, useRef, useState } from "react";
import { setAvatar, setDisplayName, setUsername, USERNAME_RE } from "../lib/db";
import { friendlyError } from "../lib/errors";
import type { LiveData } from "../lib/hooks";
import { resizeToJpeg } from "../lib/image";
import { enablePush, pushPermission } from "../lib/push";
import { Avatar } from "../components/Avatar";
import { AddPeople } from "./AddPeople";

type Step = "you" | "location" | "notifications" | "buddy" | "round";
const STEPS: Step[] = ["you", "location", "notifications", "buddy", "round"];
const key = (me: string) => `fairwhere.welcome.${me}`;

/** Where this person is in the walkthrough: a step, or "done". */
export function welcomeProgress(me: string): Step | "done" | null {
  try {
    const v = localStorage.getItem(key(me));
    return v === "done" || STEPS.includes(v as Step) ? (v as Step | "done") : null;
  } catch {
    return "done"; // no storage (private mode): don't trap them in it
  }
}
const save = (me: string, v: Step | "done") => {
  try {
    localStorage.setItem(key(me), v);
  } catch { /* fine */ }
};

/** Show it to someone who hasn't finished it and is still new (no username or no buddies yet). */
export function needsWelcome(me: string, data: LiveData): boolean {
  const p = welcomeProgress(me);
  if (p === "done") return false;
  if (p) return true; // started: resume
  const profile = data.profiles.get(me);
  const hasBuddy = data.friendships.some((f) => f.status === "accepted");
  return !profile?.username || !hasBuddy;
}

export function Welcome({ data, me, onDone }: { data: LiveData; me: string; onDone: (startRound: boolean) => void }) {
  const [step, setStep] = useState<Step>(() => {
    const p = welcomeProgress(me);
    return p && p !== "done" ? p : "you";
  });
  const [canPush, setCanPush] = useState(false);
  useEffect(() => void pushPermission().then((p) => setCanPush(p === "prompt")).catch(() => {}), []);
  const steps = STEPS.filter((s) => s !== "notifications" || canPush || step === "notifications");
  const i = steps.indexOf(step);

  const go = (next: Step | "done", startRound = false) => {
    save(me, next);
    if (next === "done") onDone(startRound);
    else setStep(next);
  };
  const nextStep = () => go(steps[i + 1] ?? "done");

  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-label="Welcome to FairWhere">
      <div className="welcome-card">
        <div className="welcome-top">
          <div className="dots" aria-label={`Step ${i + 1} of ${steps.length}`}>
            {steps.map((s, n) => <i key={s} className={n <= i ? "on" : ""} />)}
          </div>
          {step !== "round" && <button className="link" onClick={() => go("done")}>Skip setup</button>}
        </div>
        <div className="welcome-body" key={step}>
          {step === "you" && <You data={data} me={me} onNext={nextStep} />}
          {step === "location" && (
            <>
              <div className="welcome-art" aria-hidden>📍⛳️</div>
              <h2>Your location stays yours</h2>
              <p>FairWhere uses your location <b>only during a round you start</b>, to work out which hole you're on, even with your phone in your pocket.</p>
              <p>Your buddies see the hole and when you'll be done. Never where you are otherwise. Sharing stops when you finish, or by itself if you leave the course.</p>
              <button className="btn" onClick={nextStep}>Got it</button>
            </>
          )}
          {step === "notifications" && <Notifications onNext={nextStep} />}
          {step === "buddy" && (
            <>
              <h2>Add your first buddy</h2>
              <p className="note">Send your code or link, show your QR, or type theirs.</p>
              <AddPeople data={data} me={me} incomingCode={null} onCodeUsed={() => {}} />
              {data.friendships.length > 0 ? (
                <button className="btn" onClick={nextStep}>Continue</button>
              ) : (
                <button className="btn ghost" onClick={nextStep}>Skip for now</button>
              )}
            </>
          )}
          {step === "round" && (
            <>
              <div className="welcome-art" aria-hidden>🏌️</div>
              <h2>You're set</h2>
              <p>Heading out? Start a round and your buddies can follow along. Or look around first.</p>
              <button className="btn" onClick={() => go("done", true)}>Start a round</button>
              <button className="btn ghost" onClick={() => go("done")}>Later</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function You({ data, me, onNext }: { data: LiveData; me: string; onNext: () => void }) {
  const p = data.profiles.get(me);
  const [name, setName] = useState(p?.display_name ?? "");
  const [handle, setHandle] = useState(p?.username ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const clean = handle.trim().replace(/^@/, "").toLowerCase();
  const handleOk = !clean || USERNAME_RE.test(clean);

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      await setAvatar(me, await resizeToJpeg(f));
      data.reload();
    } catch (e) {
      setErr(friendlyError(e, "Couldn't add that photo. Try another."));
    } finally {
      setBusy(false);
    }
  }
  async function next() {
    setBusy(true);
    setErr(null);
    try {
      if (name.trim() && name.trim() !== p?.display_name) await setDisplayName(me, name);
      if (clean && clean !== p?.username) await setUsername(me, clean);
      data.reload();
      onNext();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>Welcome to FairWhere</h2>
      <p className="note">How your buddies will see you.</p>
      <button className="profile-photo" onClick={() => file.current?.click()} aria-label="Add a profile photo" disabled={busy}>
        <Avatar id={me} name={name || "Me"} photo={p?.avatar_url} size={88} />
        <span className="profile-cam" aria-hidden>📷</span>
      </button>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ""))} />
      <label className="f">
        Name
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
      </label>
      <label className="f">
        Username
        <span className="at-input">
          <span aria-hidden>@</span>
          <input value={handle.replace(/^@/, "")} maxLength={20} autoCapitalize="none" autoCorrect="off" spellCheck={false}
            placeholder="yourname" onChange={(e) => setHandle(e.target.value.toLowerCase())} />
        </span>
        {!handleOk && <span className="note">3–20 characters: letters, numbers, _ or .</span>}
      </label>
      {err && <p className="note err" role="alert">{err}</p>}
      <button className="btn" disabled={busy || !handleOk} onClick={next}>{busy ? "Saving…" : "Continue"}</button>
    </>
  );
}

function Notifications({ onNext }: { onNext: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="welcome-art" aria-hidden>🔔</div>
      <h2>Know when they're nearly done</h2>
      <p>Get a notification when a buddy tees off, reaches the holes you pick, or is about 30 minutes from finishing. Only for the buddies and alerts you choose.</p>
      <button className="btn" disabled={busy} onClick={async () => {
        setBusy(true);
        await enablePush().catch(() => "denied");
        setBusy(false);
        onNext();
      }}>Turn on notifications</button>
      <button className="btn ghost" onClick={onNext}>Not now</button>
    </>
  );
}
