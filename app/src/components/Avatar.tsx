// Profile photo, or initials with a stable per-person colour. A pulsing green ring
// marks someone who's out on the course (or about to tee off).

const COLORS = ["#2f8f5b", "#3478f6", "#e8743b", "#a259d9", "#d94f70", "#1f9bb5", "#c99a1a", "#5b6ee1"];

export function initials(name: string): string {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function Avatar({ id, name, photo, size = 52, badge, me, live }: {
  id: string;
  name: string;
  photo?: string | null;
  size?: number;
  badge?: string;
  me?: boolean;
  live?: boolean;
}) {
  return (
    <span className={`avatar${me ? " me" : ""}${live ? " live" : ""}`} style={{ width: size, height: size, background: colorFor(id), fontSize: size * 0.36 }} aria-hidden>
      {photo ? <img src={photo} alt="" loading="lazy" /> : initials(name)}
      {badge && <span className="badge">{badge}</span>}
    </span>
  );
}
