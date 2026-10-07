// Full-screen map behind everything (Find My style): friends as avatar pins, plus the
// selected round's course drawn from the hole centerlines. MapLibre + OpenFreeMap
// (keyless); the globe button flips to Esri satellite imagery.
import { useEffect, useRef, useState } from "react";
import maplibregl, { type ExpressionSpecification, type Map as MLMap, type Marker, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { CourseFeatures, LatLng, PlayHole } from "../lib/courses";
import { DEFAULT_TOOLS, type MapTools } from "../lib/yardage";
import { getCourseFeatures } from "../lib/db";
import { buildOverlay, drawTags, drawToolLines, placeTarget, TOOL_ROWS, type ToolsInput, type ToolsOverlay } from "./mapTools";
import { colorFor, initials } from "./Avatar";
import { courseFeatures } from "../lib/courseShapes";

const LIGHT = "https://tiles.openfreemap.org/styles/liberty";
const SATELLITE: StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    sat: {
      type: "raster",
      // Esri's newer "Clarity" imagery: sharper, and it lines up with OpenStreetMap's greens
      // (the older World_Imagery was ~7 m off at Redhawk, so flags looked off the green).
      tiles: ["https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
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
  photo?: string | null;
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

/** Where to move the camera. The map only moves when `key` changes. */
export interface MapFocus {
  key: string;
  bounds?: [[number, number], [number, number]];
  center?: [number, number];
  zoom?: number;
  /** Tee-to-green direction when framing one hole: Tee view turns the map to it. */
  bearing?: number;
  /** [tee, green] of that hole, for framing it in Tee view. */
  line?: [LatLng, LatLng];
}

/** Tee view tilt, and how much closer it can zoom (the far end of a tilted map shrinks). */
const TILT = 55, TILT_ZOOM = 0.6, TILT_AIM = 0.3;

/** North up (a plain map) or Tee view (turned and tilted down the hole, like standing on the tee). */
export type MapAngle = "north" | "tee";
const ANGLE_KEY = "fairwhere.mapAngle";

const TOOLS_KEY = "fairwhere.mapTools";
function loadTools(): MapTools {
  try {
    return { ...DEFAULT_TOOLS, ...JSON.parse(localStorage.getItem(TOOLS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_TOOLS;
  }
}

export function MapView({ pins = [], course, tools, focus, bottomPad = 0, onPin, interactive = true }: {
  pins?: MapPin[];
  course?: CourseOverlay | null;
  /** The hole being played (yardage, measure, hazards, rings). Null hides the tools button. */
  tools?: (ToolsInput & { courseId: string }) | null;
  focus?: MapFocus;
  bottomPad?: number;
  onPin?: (id: string) => void;
  interactive?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const courseRef = useRef(course);
  const onPinRef = useRef(onPin);
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
      // Credits sit top-left: the bottom of the map is under the sheet (ODbL needs them visible).
      attributionControl: false,
      pitchWithRotate: false,
    });
    m.addControl(new maplibregl.AttributionControl({
      compact: true,
      customAttribution: 'Course data © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>',
    }), "top-left");
    // Start as the small ⓘ (MapLibre opens compact credits on load); a tap shows them.
    m.once("load", () => el.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
    m.on("style.load", () => (drawCourse(m, courseRef.current), drawToolLines(m, overlayRef.current)));
    // Measure: a tap on the map moves the target there.
    m.on("click", (e) => measureRef.current && setTarget({ hole: holeRef.current, pt: [e.lngLat.lat, e.lngLat.lng] }));
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
    if (m) whenReady(m, () => (drawCourse(m, courseRef.current), drawToolLines(m, overlayRef.current)));
  }, [course]);

  // ---- hole tools
  const [opts, setOpts] = useState<MapTools>(loadTools);
  const [panel, setPanel] = useState(false);
  const [target, setTarget] = useState<{ hole: number; pt: LatLng } | null>(null);
  const [feats, setFeats] = useState<{ id: string; f: CourseFeatures | null } | null>(null);
  const holeRef = useRef(0);
  const measureRef = useRef(false);
  const overlayRef = useRef<ToolsOverlay>({ lines: [], tags: [], target: null });
  const tagMarkers = useRef<Marker[]>([]);
  const targetMarker = useRef<Marker | null>(null);
  holeRef.current = tools?.hole.n ?? 0;
  measureRef.current = Boolean(tools && opts.measure);

  const toggle = (k: keyof MapTools) => {
    const next = { ...opts, [k]: !opts[k] };
    setOpts(next);
    if (k === "measure") setTarget(null); // starts fresh, halfway to the green
    try {
      localStorage.setItem(TOOLS_KEY, JSON.stringify(next));
    } catch { /* private mode: just not remembered */ }
  };

  // Hazards need the course's mapped bunkers / water (loaded once per course, on demand).
  useEffect(() => {
    if (!tools || tools.features !== undefined || !opts.hazards || feats?.id === tools.courseId) return;
    const id = tools.courseId;
    getCourseFeatures(id).then((f) => setFeats({ id, f })).catch(() => setFeats({ id, f: null }));
  }, [tools?.courseId, opts.hazards]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const pt = target && tools && target.hole === tools.hole.n ? target.pt : null;
    const f = tools?.features !== undefined ? tools.features : feats && tools && feats.id === tools.courseId ? feats.f : null;
    const o = buildOverlay(tools ?? null, opts, pt, f);
    overlayRef.current = o;
    whenReady(m, () => drawToolLines(m, o));
    tagMarkers.current = drawTags(m, o.tags, tagMarkers.current);
    targetMarker.current = placeTarget(m, o.target, targetMarker.current, (p) => setTarget({ hole: holeRef.current, pt: p }));
  }, [tools?.hole, tools?.gps?.[0], tools?.gps?.[1], opts, target, feats]);

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
      node.replaceChildren();
      if (p.photo) {
        const img = document.createElement("img");
        img.src = p.photo;
        img.alt = "";
        node.append(img);
      } else node.append(Object.assign(document.createElement("span"), { textContent: initials(p.name) }));
      if (p.badge) node.append(Object.assign(document.createElement("b"), { textContent: p.badge }));
    }
    for (const [id, mk] of markers.current) if (!seen.has(id)) (mk.remove(), markers.current.delete(id));
  }, [pins]);

  const [angle, setAngle] = useState<MapAngle>(() => {
    try {
      return localStorage.getItem(ANGLE_KEY) === "tee" ? "tee" : "north";
    } catch {
      return "north";
    }
  });
  const flipAngle = () => {
    const next = angle === "tee" ? "north" : "tee";
    setAngle(next);
    try {
      localStorage.setItem(ANGLE_KEY, next);
    } catch { /* not remembered */ }
  };
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
    // Tee view: hole runs up the screen and the map tilts back, as if looking down it from the tee.
    // Framed by the hole's own length (a north-aligned box around a diagonal hole is far too loose).
    if (angle === "tee" && f.bearing != null && f.line) {
      const [a, b] = f.line, midLat = (a[0] + b[0]) / 2;
      const lenM = Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 111320 * Math.cos((midLat * Math.PI) / 180));
      const visH = h - top - bottom, visW = w - 2 * side;
      const mpp = Math.max((lenM * 1.15) / visH, 70 / visW); // whole hole tall, ~70 m of fairway wide
      const zoom = Math.min(f.zoom ?? 18, Math.log2((156543.03 * Math.cos((midLat * Math.PI) / 180)) / mpp) + TILT_ZOOM);
      // Tilted, the near half of the screen covers far less ground than the far half, so aim
      // the centre ~30% of the way from the tee rather than halfway.
      const c: [number, number] = [a[1] + (b[1] - a[1]) * TILT_AIM, a[0] + (b[0] - a[0]) * TILT_AIM];
      m.easeTo({ center: c, zoom, bearing: f.bearing, pitch: TILT, offset: [0, (top - bottom) / 2], duration: 900 });
    } else if (bounds) m.fitBounds(bounds, { padding, maxZoom: f.zoom ?? 16.5, duration: 900, bearing: 0, pitch: 0 });
    // bottomPad is read at focus time only; the camera shouldn't chase the sheet mid-drag.
  }, [focus?.key, angle]);

  return (
    <>
      <div ref={el} className="map-bg" />
      {interactive && (
        <div className="map-controls">
          {focus?.bearing != null && (
            <button aria-label={angle === "tee" ? "Tee view (tap for north up)" : "North up (tap for tee view)"} aria-pressed={angle === "tee"}
              onClick={flipAngle}>
              {angle === "tee" ? (
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
                  <path d="M12 3 4.5 21h15L12 3z" /><path d="M12 8v6" /><path d="M9.5 18h5" />
                </svg>
              ) : (
                <span className="map-north" aria-hidden>N</span>
              )}
            </button>
          )}
          {tools && (
            <button aria-label="Map tools" aria-expanded={panel} aria-pressed={panel} onClick={() => setPanel(!panel)}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                <path d="M12 3 2.5 8 12 13l9.5-5L12 3z" /><path d="m2.5 12 9.5 5 9.5-5" /><path d="m2.5 16 9.5 5 9.5-5" />
              </svg>
            </button>
          )}
          <button aria-label={sat ? "Show map" : "Show satellite"} aria-pressed={sat} onClick={() => setSat(!sat)}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
            </svg>
          </button>
        </div>
      )}
      {interactive && tools && panel && (
        <div className="map-tools" role="group" aria-label="Map tools">
          {TOOL_ROWS.map((r) => (
            <label key={r.key} className="map-tool">
              <input type="checkbox" checked={opts[r.key]} onChange={() => toggle(r.key)} />
              <span><b>{r.label}</b><small>{r.sub}</small></span>
            </label>
          ))}
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
  const holes: ExpressionSpecification = ["==", ["get", "kind"], "hole"];
  const links: ExpressionSpecification = ["==", ["get", "kind"], "link"];
  const isNow: ExpressionSpecification = ["==", ["get", "state"], "now"];
  const round = { "line-cap": "round", "line-join": "round" } as const;

  // Soft glow under the hole being played.
  m.addLayer({ id: "c-halo", type: "line", source: "course", filter: ["all", holes, isNow], layout: round,
    paint: { "line-color": NOW, "line-width": 24, "line-opacity": 0.2, "line-blur": 5 } });
  // Dotted walk from each green to the next tee.
  m.addLayer({ id: "c-link", type: "line", source: "course", filter: links, layout: round,
    paint: { "line-color": byState(PAST, PAST, NEXT, NOW), "line-width": ["match", ["get", "state"], "up", 3.6, 2.8],
      "line-dasharray": [0.1, 2], "line-opacity": ["match", ["get", "state"], "up", 1, "next", 0.9, 0.7] } });
  // The holes: white casing, then the coloured path.
  m.addLayer({ id: "c-casing", type: "line", source: "course", filter: holes, layout: round,
    paint: { "line-color": "#ffffff", "line-width": ["case", isNow, 13, 10], "line-opacity": 0.95 } });
  m.addLayer({ id: "c-line", type: "line", source: "course", filter: holes, layout: round,
    paint: { "line-color": byState(PAST, NOW, NEXT), "line-width": ["case", isNow, 9, 6.5] } });
  // Chevrons riding along each hole in the direction of play.
  m.addLayer({ id: "c-arrows", type: "symbol", source: "course", filter: holes,
    layout: { "symbol-placement": "line", "symbol-spacing": 56, "icon-image": "fmg-chevron", "icon-size": ["case", isNow, 0.95, 0.75],
      "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-rotation-alignment": "map" },
    paint: { "icon-color": "#ffffff" } });
  // One arrow mid-walk pointing at the next tee.
  m.addLayer({ id: "c-link-arrow", type: "symbol", source: "course", filter: links,
    layout: { "symbol-placement": "line-center", "icon-image": "fmg-chevron", "icon-size": ["match", ["get", "state"], "up", 1.35, 1.05],
      "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-rotation-alignment": "map" },
    paint: { "icon-color": byState(PAST, PAST, NEXT, NOW), "icon-halo-color": "#ffffff", "icon-halo-width": 2 } });
  // Tee badges with the hole number.
  m.addLayer({ id: "c-tee", type: "circle", source: "course", filter: ["==", ["get", "kind"], "tee"],
    paint: { "circle-radius": ["case", isNow, 11, 8.5], "circle-color": byState(PAST, NOW, NEXT),
      "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
  m.addLayer({ id: "c-tee-num", type: "symbol", source: "course", filter: ["==", ["get", "kind"], "tee"],
    layout: { "text-field": ["to-string", ["get", "n"]], "text-font": ["Noto Sans Bold"], "text-size": ["case", isNow, 12, 10],
      "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { "text-color": "#ffffff" } });
  // A little flag on every green.
  m.addLayer({ id: "c-flag", type: "symbol", source: "course", filter: ["==", ["get", "kind"], "green"],
    layout: { "icon-image": "fmg-flag", "icon-anchor": "bottom-left", "icon-offset": [-4, 2], "icon-size": ["case", isNow, 1, 0.75],
      "icon-allow-overlap": true, "icon-ignore-placement": true },
    paint: { "icon-color": byState(PAST, NOW, "#5f6b63"), "icon-halo-color": "#ffffff", "icon-halo-width": 1.2 } });
}
