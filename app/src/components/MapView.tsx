// Full-screen map behind everything (Find My style): friends as avatar pins, plus the
// selected round's course drawn from the hole centerlines. MapLibre + OpenFreeMap
// (keyless); the globe button flips to Esri satellite imagery.
import { useEffect, useRef, useState } from "react";
import maplibregl, { type ExpressionSpecification, type Map as MLMap, type Marker, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PlayHole } from "../lib/courses";
import { colorFor, initials } from "./Avatar";
import { courseFeatures } from "../lib/courseShapes";

const LIGHT = "https://tiles.openfreemap.org/styles/liberty";
const SATELLITE: StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    sat: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [{ id: "sat", type: "raster", source: "sat" }],
};
/** Temecula — Sunny's home courses (HANDOFF). Used until there's someone to show. */
export const DEFAULT_CENTER: [number, number] = [-117.11, 33.49];

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  name: string;
  badge?: string;
  me?: boolean;
  selected?: boolean;
}

export interface CourseOverlay {
  seq: PlayHole[];
  /** Current hole 1..18, or 0 when nobody's on it. */
  current: number;
  finished: boolean;
}

/** The "play this hole" ball: where it is, where it's been, and where it's aimed. */
export interface GameOverlay {
  ball: [number, number];
  trail: [number, number][][];
  aim?: [number, number] | null;
  /** 0..1 mid-flight; the ball grows a little as it "rises". */
  height?: number;
}

/** Where to move the camera. The map only moves when `key` changes. */
export interface MapFocus {
  key: string;
  bounds?: [[number, number], [number, number]];
  center?: [number, number];
  zoom?: number;
}

export function MapView({ pins = [], course, game, focus, bottomPad = 0, onPin, interactive = true }: {
  pins?: MapPin[];
  course?: CourseOverlay | null;
  game?: GameOverlay | null;
  focus?: MapFocus;
  bottomPad?: number;
  onPin?: (id: string) => void;
  interactive?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const courseRef = useRef(course);
  const gameRef = useRef(game);
  const ballRef = useRef<Marker | null>(null);
  const onPinRef = useRef(onPin);
  gameRef.current = game;
  const [sat, setSat] = useState(false);
  courseRef.current = course;
  onPinRef.current = onPin;

  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: LIGHT,
      center: DEFAULT_CENTER,
      zoom: 11.5,
      interactive,
      attributionControl: { compact: true },
      pitchWithRotate: false,
    });
    m.on("style.load", () => (drawCourse(m, courseRef.current), drawGame(m, gameRef.current)));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      markers.current.clear();
    };
  }, [interactive]);

  useEffect(() => {
    map.current?.setStyle(sat ? SATELLITE : LIGHT);
  }, [sat]);

  useEffect(() => {
    const m = map.current;
    if (m) whenReady(m, () => drawCourse(m, courseRef.current));
  }, [course]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    whenReady(m, () => drawGame(m, gameRef.current));
    if (!game) {
      ballRef.current?.remove();
      ballRef.current = null;
      return;
    }
    if (!ballRef.current) {
      const node = document.createElement("div"); // MapLibre owns this element's transform...
      node.appendChild(document.createElement("span")).className = "golf-ball"; // ...so the look lives inside
      ballRef.current = new maplibregl.Marker({ element: node, anchor: "center" }).setLngLat([game.ball[1], game.ball[0]]).addTo(m);
    }
    ballRef.current.setLngLat([game.ball[1], game.ball[0]]);
    (ballRef.current.getElement().firstChild as HTMLElement).style.setProperty("--lift", String(game.height ?? 0));
  }, [game]);

  // Avatar pins: plain DOM markers, updated in place so they glide instead of flicker.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    for (const p of pins) {
      seen.add(p.id);
      let mk = markers.current.get(p.id);
      if (!mk) {
        const node = document.createElement("button");
        node.addEventListener("click", (e) => (e.stopPropagation(), onPinRef.current?.(p.id)));
        mk = new maplibregl.Marker({ element: node, anchor: "center" }).setLngLat([p.lng, p.lat]).addTo(m);
        markers.current.set(p.id, mk);
      }
      mk.setLngLat([p.lng, p.lat]);
      const node = mk.getElement();
      node.className = `pin${p.me ? " me" : ""}${p.selected ? " selected" : ""}`;
      node.setAttribute("aria-label", `${p.me ? "You" : p.name}${p.badge ? `, hole ${p.badge}` : ""}`);
      node.style.setProperty("--pin", colorFor(p.id));
      node.innerHTML = `<span>${initials(p.name)}</span>${p.badge ? `<b>${p.badge}</b>` : ""}`;
    }
    for (const [id, mk] of markers.current) if (!seen.has(id)) (mk.remove(), markers.current.delete(id));
  }, [pins]);

  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    const m = map.current, f = focusRef.current;
    if (!m || !f) return;
    // Keep at least ~120px of map between the paddings, or MapLibre refuses to fit at all.
    const { clientWidth: w, clientHeight: h } = m.getContainer();
    const top = 96, bottom = Math.max(20, Math.min(bottomPad + 24, h - top - 120));
    const side = Math.max(10, Math.min(56, (w - 120) / 2));
    const padding = { top, bottom, left: side, right: side };
    // Always fitBounds: flyTo({padding}) would store the padding on the map and every later
    // fit adds its own on top. A single point is a zero-size box capped at `zoom`.
    const bounds = f.bounds ?? (f.center && [f.center, f.center]);
    if (bounds) m.fitBounds(bounds, { padding, maxZoom: f.zoom ?? 16.5, duration: 700 });
    // bottomPad is read at focus time only; the camera shouldn't chase the sheet mid-drag.
  }, [focus?.key]);

  return (
    <>
      <div ref={el} className="map-bg" />
      {interactive && (
        <div className="map-controls">
          <button aria-label={sat ? "Show map" : "Show satellite"} aria-pressed={sat} onClick={() => setSat(!sat)}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Run `fn` now if the style is ready, else once the map goes idle. (isStyleLoaded()
 * is false while tiles are still loading, and an overlay skipped then never appears.)
 * Callers read the latest overlay from a ref, so a late run draws the current one.
 */
function whenReady(m: MLMap, fn: () => void) {
  if (m.isStyleLoaded()) fn();
  else m.once("idle", fn);
}

// ------------------------------------------------------------------ course paths

const PAST = "#1f8a4c", NOW = "#e5484d", NEXT = "#8f9a92";
const byState = (past: string, now: string, next: string, up = now): ExpressionSpecification =>
  ["match", ["get", "state"], "past", past, "now", now, "up", up, next];
const LAYERS = ["c-flag", "c-tee-num", "c-tee", "c-link-arrow", "c-arrows", "c-line", "c-casing", "c-link", "c-halo"];

/** Small icons drawn once per style as signed-distance images, so layers can tint them. */
function ensureIcons(m: MLMap) {
  const make = (w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
    const cv = document.createElement("canvas");
    cv.width = w * 2; cv.height = h * 2;
    const c = cv.getContext("2d")!;
    c.scale(2, 2);
    c.fillStyle = c.strokeStyle = "#000";
    draw(c);
    return c.getImageData(0, 0, w * 2, h * 2);
  };
  if (!m.hasImage("fmg-chevron"))
    m.addImage("fmg-chevron", make(16, 16, (c) => {
      c.lineWidth = 3; c.lineCap = c.lineJoin = "round";
      c.beginPath(); c.moveTo(5, 3.5); c.lineTo(11, 8); c.lineTo(5, 12.5); c.stroke();
    }), { sdf: true, pixelRatio: 2 });
  if (!m.hasImage("fmg-flag"))
    m.addImage("fmg-flag", make(18, 26, (c) => {
      c.lineWidth = 2; c.lineCap = "round";
      c.beginPath(); c.moveTo(4, 24); c.lineTo(4, 3); c.stroke();
      c.beginPath(); c.moveTo(4, 2.5); c.lineTo(16, 7); c.lineTo(4, 11.5); c.closePath(); c.fill();
      c.beginPath(); c.ellipse(4, 24, 3, 1.4, 0, 0, Math.PI * 2); c.fill();
    }), { sdf: true, pixelRatio: 2 });
}

function drawCourse(m: MLMap, o: CourseOverlay | null | undefined) {
  for (const id of LAYERS) if (m.getLayer(id)) m.removeLayer(id);
  if (m.getSource("course")) m.removeSource("course");
  if (!o) return;
  ensureIcons(m);
  m.addSource("course", { type: "geojson", data: courseFeatures(o.seq, o.current, o.finished) });
  // Keep the game's ball trail and aim line on top when the course redraws.
  const add = (layer: Parameters<MLMap["addLayer"]>[0]) => m.addLayer(layer, m.getLayer("g-aim") ? "g-aim" : undefined);
  const holes: ExpressionSpecification = ["==", ["get", "kind"], "hole"];
  const links: ExpressionSpecification = ["==", ["get", "kind"], "link"];
  const isNow: ExpressionSpecification = ["==", ["get", "state"], "now"];
  const round = { "line-cap": "round", "line-join": "round" } as const;

  // Soft glow under the hole being played.
  add({ id: "c-halo", type: "line", source: "course", filter: ["all", holes, isNow], layout: round,
    paint: { "line-color": NOW, "line-width": 24, "line-opacity": 0.2, "line-blur": 5 } });
  // Dotted walk from each green to the next tee.
  add({ id: "c-link", type: "line", source: "course", filter: links, layout: round,
    paint: { "line-color": byState(PAST, PAST, NEXT, NOW), "line-width": ["match", ["get", "state"], "up", 3.6, 2.8],
      "line-dasharray": [0.1, 2], "line-opacity": ["match", ["get", "state"], "up", 1, "next", 0.9, 0.7] } });
  // The holes: white casing, then the coloured path.
  add({ id: "c-casing", type: "line", source: "course", filter: holes, layout: round,
    paint: { "line-color": "#ffffff", "line-width": ["case", isNow, 13, 10], "line-opacity": 0.95 } });
  add({ id: "c-line", type: "line", source: "course", filter: holes, layout: round,
    paint: { "line-color": byState(PAST, NOW, NEXT), "line-width": ["case", isNow, 9, 6.5] } });
  // Chevrons riding along each hole in the direction of play.
  add({ id: "c-arrows", type: "symbol", source: "course", filter: holes,
    layout: { "symbol-placement": "line", "symbol-spacing": 56, "icon-image": "fmg-chevron", "icon-size": ["case", isNow, 0.95, 0.75],
      "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-rotation-alignment": "map" },
    paint: { "icon-color": "#ffffff" } });
  // One arrow mid-walk pointing at the next tee.
  add({ id: "c-link-arrow", type: "symbol", source: "course", filter: links,
    layout: { "symbol-placement": "line-center", "icon-image": "fmg-chevron", "icon-size": ["match", ["get", "state"], "up", 1.35, 1.05],
      "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-rotation-alignment": "map" },
    paint: { "icon-color": byState(PAST, PAST, NEXT, NOW), "icon-halo-color": "#ffffff", "icon-halo-width": 2 } });
  // Tee badges with the hole number.
  add({ id: "c-tee", type: "circle", source: "course", filter: ["==", ["get", "kind"], "tee"],
    paint: { "circle-radius": ["case", isNow, 11, 8.5], "circle-color": byState(PAST, NOW, NEXT),
      "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
  add({ id: "c-tee-num", type: "symbol", source: "course", filter: ["==", ["get", "kind"], "tee"],
    layout: { "text-field": ["to-string", ["get", "n"]], "text-font": ["Noto Sans Bold"], "text-size": ["case", isNow, 12, 10],
      "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { "text-color": "#ffffff" } });
  // A little flag on every green.
  add({ id: "c-flag", type: "symbol", source: "course", filter: ["==", ["get", "kind"], "green"],
    layout: { "icon-image": "fmg-flag", "icon-anchor": "bottom-left", "icon-offset": [-4, 2], "icon-size": ["case", isNow, 1, 0.75],
      "icon-allow-overlap": true, "icon-ignore-placement": true },
    paint: { "icon-color": byState(PAST, NOW, "#5f6b63"), "icon-halo-color": "#ffffff", "icon-halo-width": 1.2 } });
}

// ------------------------------------------------------------------ hole game

function drawGame(m: MLMap, g: GameOverlay | null | undefined) {
  const data = {
    type: "FeatureCollection" as const,
    features: g
      ? [
          ...g.trail.map((t) => ({ type: "Feature" as const, properties: { kind: "trail" }, geometry: { type: "LineString" as const, coordinates: t.map((p) => [p[1], p[0]]) } })),
          ...(g.aim ? [{ type: "Feature" as const, properties: { kind: "aim" }, geometry: { type: "LineString" as const, coordinates: [[g.ball[1], g.ball[0]], [g.aim[1], g.aim[0]]] } }] : []),
        ]
      : [],
  };
  const src = m.getSource("game") as maplibregl.GeoJSONSource | undefined;
  if (src) return src.setData(data);
  m.addSource("game", { type: "geojson", data });
  m.addLayer({ id: "g-aim", type: "line", source: "game", filter: ["==", ["get", "kind"], "aim"], layout: { "line-cap": "round" },
    paint: { "line-color": "#ffffff", "line-width": 2.5, "line-dasharray": [0.1, 1.8], "line-opacity": 0.95 } });
  m.addLayer({ id: "g-trail", type: "line", source: "game", filter: ["==", ["get", "kind"], "trail"], layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": 3, "line-opacity": 0.85 } });
}
