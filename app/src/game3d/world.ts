// The 3D course for "Play this hole", built from the real hole (lib/game.ts GameHole,
// metres; x east, y north), aiming for a Wii Sports-style look: soft daylight with
// real shadows, textured grass, mowed stripes on the real fairway shapes, sand traps,
// rippling water with dirt banks, pines and round trees, hills on the horizon.
// Mapped features come from OpenStreetMap; without them it falls back to a mowed
// ribbon along the hole's line. Three.js space: X = x, Z = -y, Y up.
import * as THREE from "three";
import { TessellateModifier } from "three/examples/jsm/modifiers/TessellateModifier.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { inside, type GameHole, type XY } from "../lib/game";
import { smoothLine } from "../lib/courseShapes";

export const toV3 = (p: XY, y = 0) => new THREE.Vector3(p[0], y, -p[1]);

/** Deterministic randomness so a hole always looks the same. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The one material everything uses: soft, matte, lit by the sun. */
export function paint(color: THREE.ColorRepresentation, roughness = 0.9, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

/** Tileable speckled grass (canvas), so turf reads as grass rather than flat colour. */
function grassCanvas() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 256, 256);
  const r = rng(7);
  for (let i = 0; i < 9000; i++) {
    const v = 200 + Math.floor(r() * 55);
    g.fillStyle = `rgb(${v},${v},${v})`;
    const x = r() * 256, y = r() * 256;
    g.fillRect(x, y, 1 + r() * 1.5, 2 + r() * 3);
  }
  return c;
}

/** Tileable ripple normal map for the water (canvas noise -> normals). */
function rippleCanvas() {
  const N = 128, h = new Float32Array(N * N), r = rng(11);
  const waves = Array.from({ length: 6 }, () => ({ fx: 1 + Math.floor(r() * 4), fy: 1 + Math.floor(r() * 4), p: r() * 6.28, a: 0.5 + r() }));
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      h[y * N + x] = waves.reduce((s, w) => s + w.a * Math.sin(((x * w.fx + y * w.fy) / N) * Math.PI * 2 + w.p), 0);
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d")!, img = g.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)], dy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
      const nx = -dx * 0.35, ny = -dy * 0.35, l = Math.hypot(nx, ny, 1), i = (y * N + x) * 4;
      img.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

/** Distance from p to the polyline, and how far along it the closest point is. */
function nearest(line: XY[], p: XY): { off: number; along: number } {
  let best = { off: Infinity, along: 0 }, run = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = b[0] - a[0], dy = b[1] - a[1], seg = Math.hypot(dx, dy) || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (seg * seg)));
    const off = Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
    if (off < best.off) best = { off, along: run + seg * t };
    run += seg;
  }
  return best;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A polygon with its bounding box, so point tests can skip it cheaply. */
interface Area {
  poly: XY[];
  box: [number, number, number, number];
}
const area = (poly: XY[]): Area => ({
  poly,
  box: [Math.min(...poly.map((p) => p[0])), Math.min(...poly.map((p) => p[1])), Math.max(...poly.map((p) => p[0])), Math.max(...poly.map((p) => p[1]))],
});
const within = (a: Area, p: XY) => p[0] >= a.box[0] && p[0] <= a.box[2] && p[1] >= a.box[1] && p[1] <= a.box[3] && inside(a.poly, p);
/** The polygon pushed outward from its centre by `m` metres (for banks and lips). */
const grow = (poly: XY[], m: number): XY[] => {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map((p) => {
    const d = Math.hypot(p[0] - cx, p[1] - cy) || 1;
    return [p[0] + ((p[0] - cx) / d) * m, p[1] + ((p[1] - cy) / d) * m];
  });
};

export interface World {
  scene: THREE.Scene;
  /** Ground height (metres) at a course point. */
  heightAt: (p: XY) => number;
  /** Is this point in water? (for splashes) */
  wet: (p: XY) => boolean;
  cup: THREE.Vector3;
  aimRing: THREE.Mesh;
  /** Keep the sun's shadow box centred on the action. */
  shadowFocus: (p: THREE.Vector3) => void;
  /** Animate flag, water, clouds and the aim ring. */
  update: (t: number) => void;
  dispose: () => void;
}

export function buildWorld(hole: GameHole): World {
  const r = rng(hole.n * 7919 + Math.round(hole.green[0]));
  const scene = new THREE.Scene();
  const line = smoothLine(hole.line, 3) as XY[];
  const tee = hole.line[0], green = hole.green;
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const shadowed = <T extends THREE.Object3D>(o: T, cast = false) => ((o.receiveShadow = true), (o.castShadow = cast), o);

  // ------------------------------------------------------------ textures
  const grassImg = grassCanvas();
  const grassTex = (repeat: number) => {
    const t = keep(new THREE.CanvasTexture(grassImg));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const ripples = keep(new THREE.CanvasTexture(rippleCanvas()));
  ripples.wrapS = ripples.wrapT = THREE.RepeatWrapping;
  ripples.repeat.set(1 / 14, 1 / 14);

  // ------------------------------------------------------------ terrain
  const f = hole.features;
  const fairways = f.fairways.map(area), bunkers = f.bunkers.map(area), waters = f.water.map(area), woods = f.woods.map(area);
  const phase = r() * 10;
  const greenH = 0.9;
  const baseHeight = (p: XY) => {
    const { off } = nearest(line, p);
    const rolling = 1.3 * Math.sin(p[0] * 0.021 + phase) * Math.cos(p[1] * 0.017 - phase) + 0.7 * Math.sin((p[0] + p[1]) * 0.033 + phase * 2);
    let h = rolling * (0.3 + 0.7 * smoothstep(16, 50, off)) + Math.max(0, off - 75) * 0.06; // gentle on the fairway, bowl rises at the edges
    const dg = Math.hypot(p[0] - green[0], p[1] - green[1]);
    h = h + (greenH + 0.4 * Math.sin(phase) - h) * (1 - smoothstep(hole.greenRadius, hole.greenRadius + 10, dg)); // raised, flat green
    const dt = Math.hypot(p[0] - tee[0], p[1] - tee[1]);
    h = h + (0.5 - h) * (1 - smoothstep(4, 14, dt)); // flat tee
    return h;
  };
  // Water sits in a hollow at its own level; bunkers are scooped a little.
  const waterLevel = waters.map((w) => Math.min(...w.poly.map(baseHeight)) - 0.25);
  const heightAt = (p: XY) => {
    const h = baseHeight(p);
    for (let i = 0; i < waters.length; i++) if (within(waters[i], p)) return Math.min(h, waterLevel[i]) - 1.2;
    return bunkers.some((b) => within(b, p)) ? h - 0.35 : h;
  };
  const wet = (p: XY) => waters.some((w) => within(w, p));

  const xs = line.map((p) => p[0]), ys = line.map((p) => p[1]);
  const margin = 190;
  const minX = Math.min(...xs) - margin, maxX = Math.max(...xs) + margin, minY = Math.min(...ys) - margin, maxY = Math.max(...ys) + margin;
  const W = maxX - minX, H = maxY - minY, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const ground = keep(new THREE.PlaneGeometry(W, H, 160, 160));
  ground.rotateX(-Math.PI / 2);
  ground.translate(cx, 0, -cy);
  const pos = ground.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const rough = new THREE.Color("#5fb04a"), roughDark = new THREE.Color("#4e9c3f"), far = new THREE.Color("#4a8f45"), c = new THREE.Color();
  const woodsFloor = new THREE.Color("#3f8139"), lakeBed = new THREE.Color("#5b7d4a");
  for (let i = 0; i < pos.count; i++) {
    const p: XY = [pos.getX(i), -pos.getZ(i)];
    pos.setY(i, heightAt(p));
    const { off } = nearest(line, p);
    c.copy(rough).lerp(roughDark, (Math.sin(p[0] * 0.09) * Math.cos(p[1] * 0.07) + 1) * 0.3).lerp(far, smoothstep(55, 160, off));
    if (woods.some((w) => within(w, p))) c.lerp(woodsFloor, 0.6);
    if (wet(p)) c.copy(lakeBed);
    c.toArray(colors, i * 3);
  }
  ground.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  ground.computeVertexNormals();
  scene.add(shadowed(new THREE.Mesh(ground, keep(paint(0xffffff, 0.95, 0, { vertexColors: true, map: grassTex(W / 9) })))));

  // ------------------------------------------------------------ fairway (mowing stripes)
  const total = line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0);
  const stripeA = new THREE.Color("#8fd968"), stripeB = new THREE.Color("#7ccc58");
  /** Lay a flat polygon over the terrain, finely cut so it follows the ground. */
  const drape = (poly: XY[], lift: number, color: (p: XY) => THREE.Color) => {
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], p[1])));
    const geo = new TessellateModifier(5, 7).modify(new THREE.ShapeGeometry(shape));
    const at = geo.attributes.position as THREE.BufferAttribute;
    const cols = new Float32Array(at.count * 3);
    for (let i = 0; i < at.count; i++) {
      const p: XY = [at.getX(i), at.getY(i)];
      at.setXYZ(i, p[0], heightAt(p) + lift, -p[1]);
      color(p).toArray(cols, i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    return keep(geo);
  };
  const stripe = (p: XY) => (Math.floor(nearest(line, p).along / 12) % 2 ? stripeA : stripeB);
  const turf = keep(paint(0xffffff, 0.9, 0, { vertexColors: true, map: grassTex(1 / 9), side: THREE.DoubleSide }));
  if (fairways.length) for (const fw of fairways) scene.add(shadowed(new THREE.Mesh(drape(fw.poly, 0.07, stripe), turf)));
  else scene.add(shadowed(new THREE.Mesh(ribbon(), turf)));

  function ribbon() {
    const samples: XY[] = [];
    for (let s = 0; s <= total; s += 3) samples.push(pointAlong(line, s));
    const fw: number[] = [], fc: number[] = [], uv: number[] = [], idx: number[] = [];
    samples.forEach((p, i) => {
      const q = samples[Math.min(i + 1, samples.length - 1)], o = samples[Math.max(i - 1, 0)];
      const dx = q[0] - o[0], dy = q[1] - o[1], len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len, s = i * 3;
      const half = 17 * smoothstep(0, 30, s) * (1 - 0.35 * smoothstep(total - 40, total, s)) + 4;
      for (const side of [-1, 1]) {
        const v: XY = [p[0] + nx * half * side, p[1] + ny * half * side];
        fw.push(v[0], heightAt(v) + 0.07, -v[1]);
        uv.push(v[0], v[1]);
        (Math.floor(s / 12) % 2 ? stripeA : stripeB).toArray(fc, fc.length);
      }
      if (i) idx.push((i - 1) * 2, (i - 1) * 2 + 1, i * 2, i * 2 + 1, i * 2, (i - 1) * 2 + 1);
    });
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.Float32BufferAttribute(fw, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(fc, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  // ------------------------------------------------------------ bunkers (sand with a grassy lip)
  const sand = new THREE.Color("#f6e6b4"), lip = new THREE.Color("#c9b073");
  const sandMat = keep(paint(0xffffff, 1, 0, { vertexColors: true, side: THREE.DoubleSide }));
  for (const b of bunkers) {
    scene.add(shadowed(new THREE.Mesh(drape(grow(b.poly, 0.9), 0.05, () => lip), sandMat)));
    scene.add(shadowed(new THREE.Mesh(drape(b.poly, 0.065, () => sand), sandMat)));
  }

  // ------------------------------------------------------------ water (ripples + dirt bank)
  const bank = new THREE.Color("#b08f5e");
  const bankMat = keep(paint(0xffffff, 1, 0, { vertexColors: true, side: THREE.DoubleSide }));
  const waterMat = keep(paint("#3aa6e0", 0.12, 0.1, { transparent: true, opacity: 0.88, normalMap: ripples, normalScale: new THREE.Vector2(0.6, 0.6) }));
  waters.forEach((w, i) => {
    scene.add(shadowed(new THREE.Mesh(drape(grow(w.poly, 2.2), 0.04, () => bank), bankMat)));
    const geo = keep(new THREE.ShapeGeometry(new THREE.Shape(w.poly.map((p) => new THREE.Vector2(p[0], p[1])))));
    geo.rotateX(-Math.PI / 2); // shape XY -> ground XZ (z = -y); uvs stay in metres for the ripples
    const lake = new THREE.Mesh(geo, waterMat);
    lake.position.y = waterLevel[i];
    lake.receiveShadow = true;
    scene.add(lake);
  });

  // ------------------------------------------------------------ green, cup, flag
  const gY = heightAt(green);
  const fringe = shadowed(new THREE.Mesh(keep(new THREE.CircleGeometry(hole.greenRadius + 2.2, 48)), keep(paint("#7dd05c", 0.9, 0, { map: grassTex(0.6) }))));
  fringe.rotation.x = -Math.PI / 2;
  fringe.position.copy(toV3(green, gY + 0.08));
  const putting = shadowed(new THREE.Mesh(keep(new THREE.CircleGeometry(hole.greenRadius, 48)), keep(paint("#a6ec7c", 0.8, 0, { map: grassTex(1.2) }))));
  putting.rotation.x = -Math.PI / 2;
  putting.position.copy(toV3(green, gY + 0.1));
  // The cup: a black hole with a white rim, deep enough to see into.
  const black = keep(new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }));
  const cupMesh = new THREE.Group();
  const cupHole = new THREE.Mesh(keep(new THREE.CircleGeometry(0.42, 24)), black);
  cupHole.rotation.x = -Math.PI / 2;
  const cupWall = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.42, 0.42, 0.5, 24, 1, true)), black);
  cupWall.position.y = -0.24;
  const cupRim = new THREE.Mesh(keep(new THREE.RingGeometry(0.42, 0.5, 24)), keep(new THREE.MeshBasicMaterial({ color: 0xffffff })));
  cupRim.rotation.x = -Math.PI / 2;
  cupRim.position.y = 0.005;
  cupMesh.add(cupHole, cupWall, cupRim);
  cupMesh.position.copy(toV3(green, gY + 0.12));
  // The flag stays in the hole.
  const pole = shadowed(new THREE.Mesh(keep(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 8)), keep(paint("#ffffff", 0.5))), true);
  pole.position.copy(toV3(green, gY + 1.8));
  const flagGeo = keep(new THREE.PlaneGeometry(1.4, 0.85, 10, 4));
  flagGeo.translate(0.7, 0, 0);
  const flagBase = Float32Array.from(flagGeo.attributes.position.array as Float32Array);
  const flag = shadowed(new THREE.Mesh(flagGeo, keep(paint("#ff4b4b", 0.7, 0, { side: THREE.DoubleSide }))), true);
  flag.position.copy(toV3(green, gY + 3.07));
  scene.add(fringe, putting, cupMesh, pole, flag);

  // ------------------------------------------------------------ tee box
  const dir0 = Math.atan2(hole.line[1][1] - tee[1], hole.line[1][0] - tee[0]);
  const teeBox = shadowed(new THREE.Mesh(keep(new THREE.BoxGeometry(5, 0.3, 9)), keep(paint("#93df6c", 0.9, 0, { map: grassTex(0.5) }))));
  teeBox.position.copy(toV3(tee, heightAt(tee) - 0.1)); // top sits just above the turf, under the ball
  teeBox.rotation.y = dir0 - Math.PI / 2;
  scene.add(teeBox);
  for (const side of [-1, 1]) {
    const m = shadowed(new THREE.Mesh(keep(new THREE.SphereGeometry(0.2, 14, 10)), keep(paint(side > 0 ? "#ffffff" : "#3478f6", 0.4))), true);
    const p: XY = [tee[0] + Math.cos(dir0 + Math.PI / 2) * 2.2 * side + Math.cos(dir0) * 1.5, tee[1] + Math.sin(dir0 + Math.PI / 2) * 2.2 * side + Math.sin(dir0) * 1.5];
    m.position.copy(toV3(p, heightAt(p) + 0.32));
    scene.add(m);
  }

  // ------------------------------------------------------------ trees, bushes, flowers
  const spots: { p: XY; s: number; kind: "pine" | "round" | "bush" | "flower" }[] = [];
  const open = (p: XY) => !fairways.some((a) => within(a, p)) && !bunkers.some((a) => within(a, p)) && !wet(p);
  const inBounds = (p: XY) => p[0] > minX && p[0] < maxX && p[1] > minY && p[1] < maxY;
  const clear = (p: XY, rad: number) =>
    Math.hypot(p[0] - green[0], p[1] - green[1]) > hole.greenRadius + rad && Math.hypot(p[0] - tee[0], p[1] - tee[1]) > rad + 22 && open(p) && inBounds(p); // keep the tee camera clear
  const tree = () => (r() < 0.55 ? "pine" : "round");
  // Real, mapped trees where they stand...
  for (const t of f.trees) if (clear(t, 4)) spots.push({ p: t, s: 0.85 + r() * 0.6, kind: tree() });
  // ...the mapped woods filled in...
  for (const w of woods) {
    const [x0, y0, x1, y1] = w.box;
    const n = Math.min(160, Math.round(((x1 - x0) * (y1 - y0)) / 140));
    for (let i = 0; i < n; i++) {
      const p: XY = [x0 + r() * (x1 - x0), y0 + r() * (y1 - y0)];
      if (within(w, p) && clear(p, 8)) spots.push({ p, s: 0.8 + r() * 0.7, kind: r() < 0.85 ? tree() : "bush" });
    }
  }
  // ...rows down both sides of the hole, flowers by the rough, and a backdrop further out.
  for (let s = 10; s < total + 30; s += 7) {
    const p = pointAlong(line, Math.min(s, total));
    const q = pointAlong(line, Math.min(s + 3, total));
    const dx = q[0] - p[0] || 1e-6, dy = q[1] - p[1], len = Math.hypot(dx, dy);
    for (const side of [-1, 1]) {
      const lat = 36 + r() * 26;
      const t: XY = [p[0] + (-dy / len) * lat * side + (r() - 0.5) * 6, p[1] + (dx / len) * lat * side + (r() - 0.5) * 6];
      if (nearest(line, t).off > 32 && clear(t, 14)) spots.push({ p: t, s: 0.8 + r() * 0.7, kind: r() < 0.85 ? tree() : "bush" });
      if (r() < 0.5) {
        const fl: XY = [p[0] + (-dy / len) * (26 + r() * 6) * side, p[1] + (dx / len) * (26 + r() * 6) * side];
        if (clear(fl, 6)) spots.push({ p: fl, s: 1, kind: "flower" });
      }
    }
  }
  for (let i = 0; i < 320; i++) {
    const t: XY = [minX + r() * W, minY + r() * H];
    if (nearest(line, t).off > 80 && clear(t, 20)) spots.push({ p: t, s: 0.9 + r() * 0.9, kind: tree() });
  }
  const pines = spots.filter((x) => x.kind === "pine").slice(0, 700), rounds = spots.filter((x) => x.kind === "round").slice(0, 700);
  const bushes = spots.filter((x) => x.kind === "bush"), flowers = spots.filter((x) => x.kind === "flower");
  const pineGeo = keep(mergeGeometries([
    new THREE.ConeGeometry(2.4, 3.2, 9).translate(0, 2.4, 0),
    new THREE.ConeGeometry(1.9, 2.8, 9).translate(0, 4.0, 0),
    new THREE.ConeGeometry(1.3, 2.4, 9).translate(0, 5.5, 0),
  ])!);
  const roundGeo = keep(mergeGeometries([
    new THREE.SphereGeometry(2.3, 12, 9).translate(0, 4.2, 0),
    new THREE.SphereGeometry(1.7, 12, 9).translate(1.4, 3.6, 0.6),
    new THREE.SphereGeometry(1.6, 12, 9).translate(-1.3, 3.8, -0.5),
  ])!);
  const trunkGeo = keep(new THREE.CylinderGeometry(0.22, 0.34, 2.6, 7).translate(0, 1.3, 0));
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => shadowed(new THREE.InstancedMesh(geo, mat, Math.max(n, 1)), true);
  const trunks = inst(trunkGeo, keep(paint("#8a5f3e")), pines.length + rounds.length);
  const pineM = inst(pineGeo, keep(paint(0xffffff, 0.85)), pines.length);
  const roundM = inst(roundGeo, keep(paint(0xffffff, 0.85)), rounds.length);
  const bushM = inst(keep(new THREE.SphereGeometry(1.1, 10, 8)), keep(paint(0xffffff, 0.9)), bushes.length);
  const bloomM = inst(keep(new THREE.SphereGeometry(0.22, 8, 6)), keep(paint(0xffffff, 0.7)), flowers.length * 5);
  const pineCols = ["#2f6e3f", "#2a6438", "#356f3b", "#3b7a44"], leafy = ["#4c9a3f", "#5aa646", "#468f3c", "#62ad4c"], blossom = ["#f3a3c0", "#f2b54b"];
  const blooms = ["#ff7aa2", "#ffd166", "#ffffff", "#b388ff", "#ff9f6e"];
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let ti = 0;
  const plant = (list: typeof spots, mesh: THREE.InstancedMesh, colors: string[], rare?: string[]) =>
    list.forEach((t, i) => {
      const y = heightAt(t.p) - 0.1;
      q4.setFromAxisAngle(up, r() * Math.PI * 2);
      m4.compose(toV3(t.p, y), q4, sc.set(t.s, t.s * (0.9 + r() * 0.35), t.s));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, new THREE.Color(rare && r() < 0.06 ? rare[Math.floor(r() * rare.length)] : colors[Math.floor(r() * colors.length)]));
      m4.compose(toV3(t.p, y), q4.identity(), sc.setScalar(t.s));
      trunks.setMatrixAt(ti++, m4);
    });
  plant(pines, pineM, pineCols);
  plant(rounds, roundM, leafy, blossom);
  bushes.forEach((b, i) => {
    m4.compose(toV3(b.p, heightAt(b.p) + 0.5), q4.identity(), sc.set(b.s, b.s * 0.75, b.s));
    bushM.setMatrixAt(i, m4);
    bushM.setColorAt(i, new THREE.Color(leafy[Math.floor(r() * leafy.length)]));
  });
  let k = 0;
  flowers.forEach((fl) => {
    const col = new THREE.Color(blooms[Math.floor(r() * blooms.length)]);
    for (let j = 0; j < 5; j++, k++) {
      const p: XY = [fl.p[0] + (r() - 0.5) * 2.4, fl.p[1] + (r() - 0.5) * 2.4];
      m4.compose(toV3(p, heightAt(p) + 0.18), q4.identity(), sc.setScalar(0.7 + r() * 0.6));
      bloomM.setMatrixAt(k, m4);
      bloomM.setColorAt(k, col);
    }
  });
  trunks.count = ti;
  pineM.count = pines.length;
  roundM.count = rounds.length;
  bushM.count = bushes.length;
  bloomM.count = k;
  bloomM.castShadow = false;
  scene.add(trunks, pineM, roundM, bushM, bloomM);

  // ------------------------------------------------------------ horizon hills, sky, clouds, light
  const hillMat = keep(paint("#5f9e57", 1));
  const hillGeo = keep(new THREE.SphereGeometry(1, 18, 10));
  const reach = Math.max(W, H) / 2 + 120;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + r() * 0.3, d = reach + r() * 160;
    const hill = new THREE.Mesh(hillGeo, hillMat);
    hill.position.set(cx + Math.cos(a) * d, -10, -cy + Math.sin(a) * d);
    hill.scale.set(120 + r() * 120, 40 + r() * 45, 120 + r() * 120);
    scene.add(hill);
  }
  const skyMat = keep(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color("#3d8fe0") }, horizon: { value: new THREE.Color("#cfeaff") } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.4, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0); }",
  }));
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(1400, 24, 12)), skyMat);
  sky.position.set(cx, 0, -cy);
  scene.add(sky);
  scene.fog = new THREE.Fog("#cfeaff", 320, 1150);
  scene.add(new THREE.HemisphereLight("#d8edff", "#557f44", 1.15));
  const sun = new THREE.DirectionalLight("#fff3dc", 2.6);
  const sunOffset = new THREE.Vector3(-55, 95, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 320 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const cloudGeo = keep(new THREE.SphereGeometry(6, 14, 10)), cloudMat = keep(paint("#ffffff", 1, 0, { emissive: "#ffffff", emissiveIntensity: 0.35 }));
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 12; i++) {
    const gr = new THREE.Group();
    for (let j = 0; j < 5; j++) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      puff.position.set(j * 6.5 - 13, Math.sin(j * 1.7) * 2.5, (r() - 0.5) * 6);
      puff.scale.set(1 + r() * 0.5, 0.6 + r() * 0.3, 1 + r() * 0.4);
      gr.add(puff);
    }
    // Out in the distant sky, never hanging over the player.
    const a = r() * Math.PI * 2, d = 320 + r() * 260;
    gr.position.set(cx + Math.cos(a) * d, 110 + r() * 60, -cy + Math.sin(a) * d);
    gr.scale.setScalar(1.8 + r() * 1.2);
    clouds.push(gr);
    scene.add(gr);
  }

  // ------------------------------------------------------------ aim marker
  const aimRing = new THREE.Mesh(keep(new THREE.RingGeometry(1.6, 2.2, 32)), keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false })));
  aimRing.rotation.x = -Math.PI / 2;
  aimRing.renderOrder = 2;
  scene.add(aimRing);

  const fp = flagGeo.attributes.position as THREE.BufferAttribute;
  return {
    scene,
    heightAt,
    wet,
    cup: toV3(green, gY + 0.12),
    aimRing,
    shadowFocus(p) {
      sun.target.position.copy(p);
      sun.position.copy(p).add(sunOffset);
    },
    update(t) {
      for (let i = 0; i < fp.count; i++) {
        const x = flagBase[i * 3];
        fp.setZ(i, Math.sin(t * 5 + x * 3) * 0.12 * x);
      }
      fp.needsUpdate = true;
      ripples.offset.set(t * 0.012, t * 0.008);
      clouds.forEach((gr, i) => {
        gr.position.x += 0.02 + i * 0.002;
        if (gr.position.x > maxX + 700) gr.position.x = minX - 700;
      });
      const s = 1 + Math.sin(t * 4) * 0.08;
      aimRing.scale.set(s, s, s);
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}

export function pointAlong(line: XY[], s: number): XY {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= seg && seg > 0) return [a[0] + ((b[0] - a[0]) * s) / seg, a[1] + ((b[1] - a[1]) * s) / seg];
    s -= seg;
  }
  return line[line.length - 1];
}
