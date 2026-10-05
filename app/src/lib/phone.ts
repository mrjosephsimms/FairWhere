// Phone numbers for text-code sign-in. US numbers can be typed any way ("(951) 555-0123");
// anything else needs the + country code.

/** Normalize to E.164 (+19515550123), or null if it doesn't look like a phone number. */
export function toE164(input: string): string | null {
  const s = input.replace(/[^\d+]/g, "");
  if (s.startsWith("+")) return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
  const us = s.replace(/^1(?=\d{10}$)/, "");
  return /^[2-9]\d{9}$/.test(us) ? `+1${us}` : null;
}

/** +19515550123 -> (951) 555-0123; other countries as typed. */
export function prettyPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
