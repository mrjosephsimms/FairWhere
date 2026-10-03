// Time formatting + tee-time helpers.

export const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function fmtDur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

export function ago(ms: number, now = Date.now()): string {
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

/** Next 8-minute tee slot at least 5 minutes out (8-minute intervals are standard). */
export function nextTeeSlot(now: Date): Date {
  const d = new Date(now.getTime() + 5 * 60000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 8) * 8); // may roll into the next hour
  return d;
}

/** "HH:MM" for <input type="time">. */
export const toTimeInput = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/**
 * Turn an "HH:MM" tee time into a timestamp near `now`. A time more than 14h
 * ahead almost certainly meant earlier today/yesterday (e.g. 23:50 entered at 00:10).
 */
export function teeTimeFromInput(hhmm: string, now: Date): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const t = new Date(now);
  t.setHours(h, m, 0, 0);
  if (t.getTime() - now.getTime() > 14 * 3600e3) t.setDate(t.getDate() - 1);
  else if (now.getTime() - t.getTime() > 10 * 3600e3) t.setDate(t.getDate() + 1);
  return t;
}
