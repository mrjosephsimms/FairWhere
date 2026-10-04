import type { Mode } from "../lib/pace";

/** Golf cart for riding, a walker for walking. */
export function ModeIcon({ mode, size = 18 }: { mode: Mode; size?: number }) {
  return (
    <svg className="mode-icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={mode === "riding" ? "Riding" : "Walking"}>
      {mode === "riding" ? (
        <>
          <path d="M4 4.5h13" />
          <path d="M6.5 4.5v8M15.5 4.5v8" />
          <path d="M3 12.5h14.5l2.5 2.5v2H3z" />
          <path d="M9.5 12.5V9.5h4" />
          <circle cx="7" cy="18.5" r="1.8" fill="currentColor" />
          <circle cx="16.5" cy="18.5" r="1.8" fill="currentColor" />
        </>
      ) : (
        <>
          <circle cx="13" cy="4" r="2" />
          <path d="m9 21 3-6 2 2v4M7 12l3-4 4 1 2 4M10 8l-1 5" />
        </>
      )}
    </svg>
  );
}
