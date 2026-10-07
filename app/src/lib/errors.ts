// Errors people can read. Our own database functions raise plain-English messages ("No golfer has
// that code or username"); Postgres / network / auth internals get translated or replaced.

const OFFLINE = "You're offline. Check your connection and try again.";
const GENERIC = "Something went wrong. Please try again.";

const KNOWN: [RegExp, string][] = [
  [/failed to fetch|networkerror|load failed|network request failed|the internet connection appears to be offline/i, OFFLINE],
  [/profiles_username_key|username.*(taken|exists)/i, "That username is taken. Try another."],
  [/rounds_one_live_per_user/i, "You already have a round going. Finish or stop it first."],
  [/email rate limit|over_email_send_rate_limit|too many requests|rate limit/i, "Too many tries. Wait a few minutes and try again."],
  [/token has expired|otp.*(expired|invalid)|invalid.*otp/i, "That code has expired or isn't right. Request a new one."],
  [/invalid login credentials/i, "That password doesn't match. Forgot it, or never made one? Get a code instead."],
  [/password should be at least/i, "Passwords need at least 8 characters."],
  [/same_password|new password should be different/i, "That's already your password."],
  [/jwt expired|refresh token/i, "You've been signed out. Sign in again."],
];

/** Looks like a database / server internal rather than something written for a person. */
const TECHNICAL = /violates|constraint|duplicate key|syntax|permission denied|jwt|pgrst|relation |column |does not exist|invalid input|null value|unexpected|undefined|status code|\bsql\b|42\d{3}|23\d{3}|P0\d{3}/i;

export function friendlyError(e: unknown, fallback = GENERIC): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return OFFLINE;
  const msg = (e instanceof Error ? e.message : typeof e === "string" ? e : (e as { message?: string } | null)?.message) ?? "";
  for (const [re, text] of KNOWN) if (re.test(msg)) return text;
  if (!msg || TECHNICAL.test(msg) || msg.length > 140) return fallback;
  return msg;
}
