import { useEffect, useState, type FormEvent } from "react";
import { phoneSignInEnabled, supabase } from "../lib/supabase";
import { authRedirect, signInWithProvider } from "../lib/native";
import { prettyPhone, toE164 } from "../lib/phone";
import { PasswordInput } from "../components/PasswordInput";

type Via = "email" | "phone";

export function SignIn() {
  // Phone appears once the project has an SMS provider (Twilio) connected.
  const [phoneOk, setPhoneOk] = useState(false);
  useEffect(() => void phoneSignInEnabled().then(setPhoneOk), []);
  const [via, setVia] = useState<Via>("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState<{ via: Via; to: string } | null>(null);
  const [code, setCode] = useState("");
  // People who made a password (Me tab / Edit profile) can skip the code.
  const [usePw, setUsePw] = useState(false);
  const [password, setPassword] = useState("");
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

  async function send(e: FormEvent) {
    e.preventDefault();
    if (usePw) {
      const num = via === "phone" ? toE164(phone) : null;
      if (via === "phone" && !num) return setErr("Enter a 10-digit phone number (or + country code).");
      await run(async () => {
        const { error } = num
          ? await supabase.auth.signInWithPassword({ phone: num, password })
          : await supabase.auth.signInWithPassword({ email: email.trim(), password });
        // Supabase says "Invalid login credentials" for both wrong passwords and no password set.
        return { error: error && /invalid login/i.test(error.message)
          ? { message: "That password doesn't match. Forgot it, or never made one? Get a code instead." }
          : error };
      });
      return;
    }
    if (via === "email") {
      const addr = email.trim();
      if (await run(() => supabase.auth.signInWithOtp({ email: addr, options: { emailRedirectTo: authRedirect() } })))
        setSentTo({ via, to: addr });
    } else {
      const num = toE164(phone);
      if (!num) return setErr("Enter a 10-digit phone number (or + country code).");
      if (await run(() => supabase.auth.signInWithOtp({ phone: num }))) setSentTo({ via, to: num });
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    const token = code.trim();
    await run(() =>
      sentTo!.via === "email"
        ? supabase.auth.verifyOtp({ email: sentTo!.to, token, type: "email" })
        : supabase.auth.verifyOtp({ phone: sentTo!.to, token, type: "sms" }),
    );
  }

  const switchVia = (v: Via) => (setVia(v), setErr(null));

  return (
    <div className="card signin">
      <h1>Fair<span>Where</span></h1>
      <button className="btn dark" disabled={busy} onClick={() => run(() => signInWithProvider("apple"))}>
        Continue with Apple
      </button>
      <button className="btn ghost" disabled={busy} onClick={() => run(() => signInWithProvider("google"))}>
        Continue with Google
      </button>
      <div className="or">or</div>
      {!sentTo ? (
        <form onSubmit={send}>
          {phoneOk && (
            <div className="segmented" role="radiogroup" aria-label="Sign in with">
              {(["email", "phone"] as Via[]).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={via === v} onClick={() => switchVia(v)}>
                  {v === "email" ? "Email" : "Phone"}
                </button>
              ))}
            </div>
          )}
          {via === "email" ? (
            <>
              <label className="f">
                Email
                <input type="email" autoComplete="email" inputMode="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </label>
              {!usePw && <button className="btn" disabled={busy || !email.trim()}>Email me a sign-in link</button>}
            </>
          ) : (
            <>
              <label className="f">
                Phone number
                <input type="tel" autoComplete="tel" inputMode="tel" required value={phone}
                  onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-0123" />
              </label>
              {!usePw && <button className="btn" disabled={busy || !phone.trim()}>Text me a code</button>}
            </>
          )}
          {usePw && (
            <>
              <label className="f">
                Password
                <PasswordInput value={password} onChange={setPassword} />
              </label>
              <button className="btn" disabled={busy || !password || !(via === "email" ? email.trim() : phone.trim())}>Sign in</button>
            </>
          )}
          <button type="button" className="link center" onClick={() => (setUsePw(!usePw), setErr(null))}>
            {usePw ? `Forgot it? ${via === "email" ? "Email" : "Text"} me a code instead` : "Have a password? Sign in with it"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <p className="note">
            {sentTo.via === "email"
              ? <>We sent a link to <b>{sentTo.to}</b>. Tap it on this phone, or enter the code from the email.</>
              : <>We texted a code to <b>{prettyPhone(sentTo.to)}</b>.</>}
          </p>
          <label className="f">
            Code
            <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <button className="btn" disabled={busy || code.trim().length < 6}>Sign in</button>
          <button type="button" className="btn ghost" onClick={() => (setSentTo(null), setCode(""))}>
            {sentTo.via === "email" ? "Use a different email" : "Use a different number"}
          </button>
        </form>
      )}
      {err && <p className="note err" role="alert">{err}</p>}
    </div>
  );
}
