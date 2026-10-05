// Course picker: tap, start typing, pick from the suggestions. Nearest courses come
// first (with distances) when the phone has already allowed location.
import { useEffect, useMemo, useRef, useState } from "react";
import type { CourseData, LatLng } from "../lib/courses";
import { metresFromCourse } from "../lib/leaveCourse";

/** Lower-case words, for "starts with" matching on any word ("red" finds "Redhawk Golf Club"). */
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const town = (c: CourseData) => c.address?.split(",").map((x) => x.trim()).find((x) => /[a-z]/i.test(x) && !/\d/.test(x)) ?? "";

export function matchCourses(courses: CourseData[], query: string): CourseData[] {
  const q = words(query);
  if (!q.length) return courses;
  return courses.filter((c) => {
    const hay = words(`${c.name} ${c.address ?? ""}`);
    return q.every((w) => hay.some((h) => h.startsWith(w)));
  });
}

export function CourseSearch({ courses, value, onChange, here }: {
  courses: CourseData[];
  value: string;
  onChange: (id: string) => void;
  /** Where the phone is, if known: sorts nearest first. */
  here: LatLng | null;
}) {
  const selected = courses.find((c) => c.id === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);

  const dist = useMemo(() => {
    const m = new Map<string, number>();
    if (here) courses.forEach((c) => m.set(c.id, metresFromCourse(c, here)));
    return m;
  }, [courses, here]);

  const list = useMemo(() => {
    const hits = matchCourses(courses, query);
    return [...hits].sort((a, b) => (here ? dist.get(a.id)! - dist.get(b.id)! : a.name.localeCompare(b.name))).slice(0, 30);
  }, [courses, query, dist, here]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const pick = (id: string) => (onChange(id), setOpen(false), setQuery(""));
  const miles = (m: number) => (m < 1609 ? "here" : `${(m / 1609.34).toFixed(m < 16093 ? 1 : 0)} mi`);

  return (
    <div className="course-search" ref={box}>
      <input
        value={open ? query : selected?.name ?? ""}
        placeholder={open ? "Type a course name or town" : "Choose a course"}
        onFocus={() => (setOpen(true), setQuery(""))}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && list[0]) (e.preventDefault(), pick(list[0].id));
          if (e.key === "Escape") setOpen(false);
        }}
        role="combobox" aria-expanded={open} aria-autocomplete="list" aria-controls="course-options"
        autoComplete="off" autoCorrect="off" spellCheck={false}
      />
      {open && (
        <ul className="course-options" id="course-options" role="listbox">
          {list.map((c) => (
            <li key={c.id} role="option" aria-selected={c.id === value}>
              <button type="button" onClick={() => pick(c.id)}>
                <span className="row-main">
                  <b>{c.name}</b>
                  <span className="sub">{[town(c), c.nines ? `${c.nines.length * 9} holes` : null].filter(Boolean).join(" · ")}</span>
                </span>
                {here && <span className="sub course-dist">{miles(dist.get(c.id)!)}</span>}
              </button>
            </li>
          ))}
          {!list.length && <li className="sub course-none">No course matches “{query}”.</li>}
        </ul>
      )}
    </div>
  );
}
