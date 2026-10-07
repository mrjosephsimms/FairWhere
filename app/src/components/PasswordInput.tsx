import { useState } from "react";

/** Password field with a Show / Hide toggle. */
export function PasswordInput({ value, onChange, isNew, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  /** New password (lets the phone suggest one) vs. signing in with an existing one. */
  isNew?: boolean;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw-input">
      <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)}
        autoComplete={isNew ? "new-password" : "current-password"} autoCapitalize="none" autoCorrect="off" spellCheck={false}
        placeholder={placeholder} />
      <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
        {show ? "Hide" : "Show"}
      </button>
    </span>
  );
}
