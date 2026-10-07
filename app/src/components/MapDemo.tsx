// Dev-only: http://localhost:5180/?demo=map&hole=9&at=0.4 shows Redhawk's hole on the map
// with the hole tools, no sign-in. `at` = where "you" stand along the hole (0 tee, 1 green;
// leave it off to measure from the tee). Never shipped (see App.tsx).
import { useMemo } from "react";
import { playSequence } from "../lib/courses";
import { course, features } from "../lib/fixtures";
import { alongLine, bearingDeg, courseBounds } from "../lib/geo";
import { MapView } from "./MapView";

export default function MapDemo() {
  const q = new URLSearchParams(location.search);
  const n = Math.min(Math.max(Number(q.get("hole") || 1), 1), 18);
  const at = q.get("at");
  const seq = useMemo(() => playSequence(course("redhawk")), []);
  const hole = seq[n - 1];
  const green = hole.green?.center ?? hole.centerline[hole.centerline.length - 1];
  const me = at != null ? alongLine(hole.centerline, Number(at)) : null;
  return (
    <MapView
      pins={me ? [{ id: "demo-me", lat: me[0], lng: me[1], name: "Me", me: true }] : []}
      course={{ seq, current: n, finished: false }}
      tools={{ hole, gps: me, courseId: "redhawk", features: features("redhawk") }}
      focus={{ key: `demo-${n}`, bounds: courseBounds([hole]), zoom: 18,
        bearing: bearingDeg(hole.centerline[0], green), line: [hole.centerline[0], green] }}
    />
  );
}
