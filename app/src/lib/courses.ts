// Course data (data/courses.json, stored in the `courses` table) and play order.

export type LatLng = [number, number];

export interface Hole {
  ref: string;
  nine: string | null;
  number: number;
  par: number;
  /** OSM had no par tag; guessed from length. Verify against the real scorecard. */
  parInferred: boolean;
  yards: number | null;
  /** Tee -> green centerline. */
  centerline: LatLng[];
  green?: { center: LatLng; polygon: LatLng[] } | null;
}

export interface CourseData {
  id: string;
  name: string;
  address: string | null;
  /** null = a plain 18; otherwise 9-hole loops and a round is two different ones. */
  nines: string[] | null;
  routing?: string;
  holes: Hole[];
}

/**
 * Mapped features around a course (OpenStreetMap via scripts/fetch_features.py), in the
 * `courses.features` column. Polygons are [lat, lng] rings; trees are single points.
 */
export interface CourseFeatures {
  fairways: LatLng[][];
  bunkers: LatLng[][];
  water: LatLng[][];
  woods: LatLng[][];
  trees: LatLng[];
}

/** A hole in the order it's played this round; `n` is 1..18. */
export interface PlayHole extends Hole {
  n: number;
}

/**
 * The 18 holes in play order. Plain courses play 1-18; 27-hole courses play
 * the chosen front nine 1-9 then the back nine, numbered 10-18 in the app.
 */
export function playSequence(course: CourseData, nines?: string[] | null): PlayHole[] {
  let holes: Hole[];
  if (course.nines) {
    const [front, back] = nines ?? [];
    if (!front || !back || front === back || !course.nines.includes(front) || !course.nines.includes(back)) {
      throw new Error(`${course.name}: pick two different nines from ${course.nines.join(", ")}`);
    }
    const nine = (name: string) =>
      course.holes.filter((h) => h.nine === name).sort((a, b) => a.number - b.number);
    holes = [...nine(front), ...nine(back)];
  } else {
    holes = [...course.holes].sort((a, b) => a.number - b.number);
  }
  if (holes.length !== 18) throw new Error(`${course.name}: expected 18 holes, found ${holes.length}`);
  return holes.map((h, i) => ({ ...h, n: i + 1 }));
}

export function courseLabel(course: Pick<CourseData, "name">, nines?: string[] | null): string {
  return nines?.length === 2 ? `${course.name} · ${nines[0]} / ${nines[1]}` : course.name;
}
