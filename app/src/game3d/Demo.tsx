// Dev-only playground: http://localhost:5180/?demo=game&hole=12 opens the 3D hole game
// on Redhawk with no sign-in and nothing saved. Never shipped (see App.tsx).
import { useMemo } from "react";
import { playSequence } from "../lib/courses";
import { course, features } from "../lib/fixtures";
import HoleGame from "./HoleGame";

export default function Demo() {
  const n = Number(new URLSearchParams(location.search).get("hole") || 1);
  const hole = useMemo(() => playSequence(course("redhawk"))[Math.min(Math.max(n, 1), 18) - 1], [n]);
  return (
    <HoleGame
      roundId="demo"
      courseId="redhawk"
      features={features("redhawk")}
      hole={hole}
      me="demo-player"
      owner={{ id: "demo-golfer", name: "Mike", score: hole.par + 1 }}
      plays={[]}
      profiles={new Map()}
      save={false}
      onClose={() => location.assign(`?demo=game&hole=${(n % 18) + 1}`)}
    />
  );
}
