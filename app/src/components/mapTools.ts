// Draws the hole tools (lib/yardage.ts) on the map: lines and rings as a GeoJSON layer,
// yardage tags as small DOM markers, and the draggable measuring target.
import maplibregl, { type Map as MLMap, type Marker } from "maplibre-gl";
import type { CourseFeatures, LatLng, PlayHole } from "../lib/courses";
import {
  defaultTarget, greenYards, hazardsAhead, layupRings, originFor, splitYards, type MapTools,
} from "../lib/yardage";

export interface ToolsInput {
  hole: PlayHole;
  /** Your GPS position when this is your own round. */
  gps: LatLng | null;
  /** Bunkers / water, when already at hand (else MapView loads them for Hazards). */
  features?: CourseFeatures | null;
}

type Tag = { at: LatLng; cls: string; big: string; small?: string };
export interface ToolsOverlay {
  lines: { pts: LatLng[]; kind: "yardage" | "measure" | "ring" }[];
  tags: Tag[];
  /** Measuring target position, when Measure is on. */
  target: LatLng | null;
}

const EMPTY: ToolsOverlay = { lines: [], tags: [], target: null };
const mid = (a: LatLng, b: LatLng): LatLng => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export function buildOverlay(t: ToolsInput | null, opts: MapTools, target: LatLng | null, feats: CourseFeatures | null): ToolsOverlay {
  if (!t) return EMPTY;
  const { hole } = t;
  const from = originFor(hole, t.gps);
  const green = hole.green?.center ?? hole.centerline[hole.centerline.length - 1];
  const out: ToolsOverlay = { lines: [], tags: [], target: null };

  if (opts.rings)
    for (const r of layupRings(hole)) {
      out.lines.push({ pts: r.ring, kind: "ring" });
      out.tags.push({ at: r.label, cls: "ring", big: String(r.yards) });
    }
  if (opts.hazards)
    for (const h of hazardsAhead(from.pt, hole, feats))
      out.tags.push({ at: h.at, cls: `hz ${h.kind}`, big: `${h.reach}–${h.carry}` });
  if (opts.measure) {
    const pt = target ?? defaultTarget(from.pt, hole);
    const { toTarget, toGreen } = splitYards(from.pt, pt, hole);
    out.target = pt;
    out.lines.push({ pts: [from.pt, pt, green], kind: "measure" });
    out.tags.push({ at: mid(from.pt, pt), cls: "measure", big: String(toTarget) });
    out.tags.push({ at: mid(pt, green), cls: "measure", big: String(toGreen) });
  }
  if (opts.yardage) {
    const y = greenYards(from.pt, hole);
    if (!opts.measure) out.lines.push({ pts: [from.pt, green], kind: "yardage" });
    out.tags.push({
      at: green, cls: "green", big: String(y.center),
      small: [y.front != null ? `F ${y.front}` : null, y.back != null ? `B ${y.back}` : null, from.fromYou ? null : "from tee"]
        .filter(Boolean).join(" · ") || undefined,
    });
  }
  return out;
}

const LAYERS = ["t-measure", "t-yardage", "t-ring"];

/** (Re)draw the line layers on top of everything else. Safe to call after a style change. */
export function drawToolLines(m: MLMap, o: ToolsOverlay) {
  const data: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: o.lines.map((l) => ({
      type: "Feature", properties: { kind: l.kind },
      geometry: { type: "LineString", coordinates: l.pts.map(([lat, lng]) => [lng, lat]) },
    })),
  };
  const src = m.getSource("tools") as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData(data);
    for (const id of LAYERS) if (m.getLayer(id)) m.moveLayer(id); // stay above the course
    return;
  }
  m.addSource("tools", { type: "geojson", data });
  const is = (k: string) => ["==", ["get", "kind"], k] as maplibregl.ExpressionSpecification;
  m.addLayer({ id: "t-ring", type: "line", source: "tools", filter: is("ring"),
    paint: { "line-color": "#ffffff", "line-width": 2, "line-opacity": 0.85, "line-dasharray": [2, 2] } });
  m.addLayer({ id: "t-yardage", type: "line", source: "tools", filter: is("yardage"), layout: { "line-cap": "round" },
    paint: { "line-color": "#ffffff", "line-width": 2.5, "line-dasharray": [1, 1.6] } });
  m.addLayer({ id: "t-measure", type: "line", source: "tools", filter: is("measure"), layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": 3 } });
}

/** Yardage tags as DOM markers (crisp text, easy styling). Replaced wholesale; there are only a few. */
export function drawTags(m: MLMap, tags: Tag[], live: Marker[]): Marker[] {
  live.forEach((mk) => mk.remove());
  return tags.map((t) => {
    const el = document.createElement("div");
    el.className = `ytag ${t.cls}`;
    el.append(Object.assign(document.createElement("b"), { textContent: t.big }));
    if (t.small) el.append(Object.assign(document.createElement("small"), { textContent: t.small }));
    return new maplibregl.Marker({ element: el, anchor: t.cls === "green" ? "bottom" : "center", offset: t.cls === "green" ? [0, -30] : [0, 0] })
      .setLngLat([t.at[1], t.at[0]]).addTo(m);
  });
}

/** The draggable target. Created once and moved, so a drag in progress isn't interrupted. */
export function placeTarget(m: MLMap, at: LatLng | null, mk: Marker | null, onMove: (p: LatLng) => void): Marker | null {
  if (!at) {
    mk?.remove();
    return null;
  }
  if (!mk) {
    const el = document.createElement("div");
    el.className = "ytarget";
    el.setAttribute("aria-label", "Measuring point: drag to move");
    mk = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([at[1], at[0]]).addTo(m);
    const report = () => { const p = mk!.getLngLat(); onMove([p.lat, p.lng]); };
    mk.on("dragstart", () => (el.dataset.dragging = "1"));
    mk.on("drag", report);
    mk.on("dragend", () => (delete el.dataset.dragging, report()));
  } else if (!mk.getElement().dataset.dragging) {
    mk.setLngLat([at[1], at[0]]);
  }
  if (!mk.getElement().isConnected) mk.addTo(m);
  return mk;
}

export const TOOL_ROWS: { key: keyof MapTools; label: string; sub: string }[] = [
  { key: "yardage", label: "Yardage", sub: "To the front, middle and back of the green. Follows you as you play." },
  { key: "measure", label: "Measure", sub: "Drag the target (or tap the map) for yards to it and from it to the green." },
  { key: "hazards", label: "Hazards", sub: "Yards to reach and carry bunkers and water ahead." },
  { key: "rings", label: "Layup rings", sub: "100, 150 and 200 yards out from the green." },
];
