import { useState, type FormEvent } from "react";
import { passwordProblem, savePassword } from "../lib/password";
import { PasswordInput } from "./PasswordInput";

/** New-password field + Save. Used by the Me-tab prompt and Edit profile. */
export function PasswordForm({ label, cta, onSaved, children }: {
  label: string;
  cta: string;
  onSaved?: () => void;
  /** Extra buttons next to Save (e.g. "Not now"). */
  children?: React.ReactNode;
}) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ err: boolean; text: string } | null>(null);
  const problem = passwordProblem(pw);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem) return setMsg({ err: true, text: problem });
    setBusy(true);
    const { error } = await savePassword(pw);
    setBusy(false);
    if (error) return setMsg({ err: true, text: error.message });
    setPw("");
    setMsg({ err: false, text: "Password saved. Use it next time you sign in." });
    onSaved?.();
  }

  return (
    <form className="pw-form" onSubmit={submit}>
      <label className="f">
        {label}
        <PasswordInput value={pw} onChange={(v) => (setPw(v), setMsg(null))} isNew placeholder="8+ characters" />
      </label>
      <div className="actions">
        <button className="btn" disabled={busy || !pw}>{cta}</button>
        {children}
      </div>
      {msg && <p className={`note${msg.err ? " err" : ""}`} role={msg.err ? "alert" : "status"}>{msg.text}</p>}
    </form>
  );
}
