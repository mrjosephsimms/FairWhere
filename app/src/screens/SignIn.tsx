import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { authRedirect, signInWithProvider } from "../lib/native";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<{ error: { message: string } | null }>) {
    setBusy(true);
    setErr(null);
    try {
      const { error } = await fn();
      if (error) setErr(error.message);
      return !error;
    } finally {
      setBusy(false);
    }
  }

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    const addr = email.trim();
    if (await run(() => supabase.auth.signInWithOtp({ email: addr, options: { emailRedirectTo: authRedirect() } })))
      setSentTo(addr);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    await run(() => supabase.auth.verifyOtp({ email: sentTo!, token: code.trim(), type: "email" }));
  }

  return (
    <div className="card signin">
      <h1>Find My <span>Golfer</span></h1>
      <p className="lede">See which hole your friends are on and when they'll be done. No more "where are you?" texts.</p>
      <button className="btn dark" disabled={busy} onClick={() => run(() => signInWithProvider("apple"))}>
        Continue with Apple
      </button>
      <button className="btn ghost" disabled={busy} onClick={() => run(() => signInWithProvider("google"))}>
        Continue with Google
      </button>
      <div className="or">or</div>
      {!sentTo ? (
        <form onSubmit={sendLink}>
          <label className="f">
            Email
            <input type="email" autoComplete="email" inputMode="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <button className="btn" disabled={busy || !email.trim()}>Email me a sign-in link</button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <p className="note">
            We sent a link to <b>{sentTo}</b>. Tap it on this phone, or enter the code from the email.
          </p>
          <label className="f">
            Code
            <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <button className="btn" disabled={busy || code.trim().length < 6}>Sign in</button>
          <button type="button" className="btn ghost" onClick={() => (setSentTo(null), setCode(""))}>Use a different email</button>
        </form>
      )}
      {err && <p className="note err" role="alert">{err}</p>}
    </div>
  );
}
