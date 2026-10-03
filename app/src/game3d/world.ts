// The 3D course for "Play this hole", built from the real hole geometry (lib/game.ts
// GameHole, metres; x east, y north). Toon-shaded, Animal Crossing-ish: rolling hills,
// a mowed fairway ribbon along the hole's actual line, a raised green with a waving
// flag, cartoon trees and flowers, drifting clouds. Three.js space: X = x, Z = -y, Y up.
import * as THREE from "three";
import type { GameHole, XY } from "../lib/game";
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

/** Three-step cel shading shared by every toon material. */
let toonRamp: THREE.DataTexture | null = null;
export function toon(color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) {
  if (!toonRamp) {
    toonRamp = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
    toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter;
    toonRamp.needsUpdate = true;
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: toonRamp, ...extra });
}

/** Low-poly look: per-face normals (the geometry is already non-indexed). */
function faceted<T extends THREE.BufferGeometry>(geo: T): T {
  geo.computeVertexNormals();
  return geo;
}

/** Soft round shadow under things (cheaper and cuter than real shadows). */
export function blob(radius: number, opacity = 0.22) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), new THREE.MeshBasicMaterial({ color: 0x0b2a12, transparent: true, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
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

export interface World {
  scene: THREE.Scene;
  /** Ground height (metres) at a course point. */
  heightAt: (p: XY) => number;
  cup: THREE.Vector3;
  aimRing: THREE.Mesh;
  /** Pole + flag: pulled out while putting, like real golf (and so it doesn't block the view). */
  flagstick: THREE.Group;
  /** Animate flag, clouds and the aim ring. */
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

  // ------------------------------------------------------------ terrain
  const phase = r() * 10;
  const greenH = 0.9;
  const heightAt = (p: XY) => {
    const { off } = nearest(line, p);
    const rolling = 1.3 * Math.sin(p[0] * 0.021 + phase) * Math.cos(p[1] * 0.017 - phase) + 0.7 * Math.sin((p[0] + p[1]) * 0.033 + phase * 2);
    let h = rolling * (0.3 + 0.7 * smoothstep(16, 50, off)) + Math.max(0, off - 75) * 0.06; // gentle on the fairway, bowl rises at the edges
    const dg = Math.hypot(p[0] - green[0], p[1] - green[1]);
    h = h + (greenH + 0.4 * Math.sin(phase) - h) * (1 - smoothstep(hole.greenRadius, hole.greenRadius + 10, dg)); // raised, flat green
    const dt = Math.hypot(p[0] - tee[0], p[1] - tee[1]);
    h = h + (0.5 - h) * (1 - smoothstep(4, 14, dt)); // flat tee
    return h;
  };

  const xs = line.map((p) => p[0]), ys = line.map((p) => p[1]);
  const margin = 170;
  const minX = Math.min(...xs) - margin, maxX = Math.max(...xs) + margin, minY = Math.min(...ys) - margin, maxY = Math.max(...ys) + margin;
  const W = maxX - minX, H = maxY - minY;
  const ground = keep(new THREE.PlaneGeometry(W, H, 110, 110));
  ground.rotateX(-Math.PI / 2);
  ground.translate((minX + maxX) / 2, 0, -(minY + maxY) / 2);
  const pos = ground.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const rough = new THREE.Color("#79c25f"), roughDark = new THREE.Color("#5fae54"), far = new THREE.Color("#4f9a4e"), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const p: XY = [pos.getX(i), -pos.getZ(i)];
    pos.setY(i, heightAt(p));
    const { off } = nearest(line, p);
    c.copy(rough).lerp(roughDark, (Math.sin(p[0] * 0.09) * Math.cos(p[1] * 0.07) + 1) * 0.25).lerp(far, smoothstep(55, 140, off));
    c.toArray(colors, i * 3);
  }
  ground.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  ground.computeVertexNormals();
  scene.add(new THREE.Mesh(ground, keep(toon(0xffffff, { vertexColors: true }))));

  // ------------------------------------------------------------ fairway ribbon (mowing stripes)
  const samples: XY[] = [];
  const total = line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0);
  for (let s = 0; s <= total; s += 3) samples.push(pointAlong(line, s));
  const fw: number[] = [], fc: number[] = [], idx: number[] = [];
  const stripeA = new THREE.Color("#a3e27f"), stripeB = new THREE.Color("#93d771");
  samples.forEach((p, i) => {
    const q = samples[Math.min(i + 1, samples.length - 1)], o = samples[Math.max(i - 1, 0)];
    const dx = q[0] - o[0], dy = q[1] - o[1], len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, s = i * 3;
    const half = 17 * smoothstep(0, 30, s) * (1 - 0.35 * smoothstep(total - 40, total, s)) + 4;
    for (const side of [-1, 1]) {
      const v: XY = [p[0] + nx * half * side, p[1] + ny * half * side];
      fw.push(v[0], heightAt(v) + 0.07, -v[1]);
      (Math.floor(s / 12) % 2 ? stripeA : stripeB).toArray(fc, fc.length);
    }
    if (i) idx.push((i - 1) * 2, (i - 1) * 2 + 1, i * 2, i * 2 + 1, i * 2, (i - 1) * 2 + 1);
  });
  const fairway = keep(new THREE.BufferGeometry());
  fairway.setAttribute("position", new THREE.Float32BufferAttribute(fw, 3));
  fairway.setAttribute("color", new THREE.Float32BufferAttribute(fc, 3));
  fairway.setIndex(idx);
  fairway.computeVertexNormals();
  scene.add(new THREE.Mesh(fairway, keep(toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide }))));

  // ------------------------------------------------------------ green, cup, flag
  const gY = heightAt(green);
  const fringe = new THREE.Mesh(keep(new THREE.CircleGeometry(hole.greenRadius + 2.2, 48)), keep(toon("#8fd86c")));
  fringe.rotation.x = -Math.PI / 2;
  fringe.position.copy(toV3(green, gY + 0.08));
  const putting = new THREE.Mesh(keep(new THREE.CircleGeometry(hole.greenRadius, 48)), keep(toon("#b4f08f")));
  putting.rotation.x = -Math.PI / 2;
  putting.position.copy(toV3(green, gY + 0.1));
  const cupMesh = new THREE.Mesh(keep(new THREE.CircleGeometry(0.42, 20)), keep(new THREE.MeshBasicMaterial({ color: 0x1d2b20 })));
  cupMesh.rotation.x = -Math.PI / 2;
  cupMesh.position.copy(toV3(green, gY + 0.12));
  const pole = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 8)), keep(toon("#ffffff")));
  pole.position.copy(toV3(green, gY + 1.8));
  const flagGeo = keep(new THREE.PlaneGeometry(1.5, 0.9, 10, 4));
  flagGeo.translate(0.75, 0, 0);
  const flagBase = Float32Array.from(flagGeo.attributes.position.array as Float32Array);
  const flag = new THREE.Mesh(flagGeo, keep(toon("#ff5a5f", { side: THREE.DoubleSide })));
  flag.position.copy(toV3(green, gY + 3.05));
  const flagstick = new THREE.Group();
  flagstick.add(pole, flag);
  scene.add(fringe, putting, cupMesh, flagstick);

  // ------------------------------------------------------------ tee box
  const dir0 = Math.atan2(hole.line[1][1] - tee[1], hole.line[1][0] - tee[0]);
  const teeBox = new THREE.Mesh(keep(new THREE.BoxGeometry(5, 0.3, 9)), keep(toon("#a3e27f")));
  teeBox.position.copy(toV3(tee, heightAt(tee) - 0.1)); // top sits just above the turf, under the ball
  teeBox.rotation.y = dir0 - Math.PI / 2;
  scene.add(teeBox);
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(keep(new THREE.SphereGeometry(0.22, 12, 8)), keep(toon(side > 0 ? "#ffffff" : "#3478f6")));
    const p: XY = [tee[0] + Math.cos(dir0 + Math.PI / 2) * 2.2 * side + Math.cos(dir0) * 1.5, tee[1] + Math.sin(dir0 + Math.PI / 2) * 2.2 * side + Math.sin(dir0) * 1.5];
    m.position.copy(toV3(p, heightAt(p) + 0.35));
    scene.add(m);
  }

  // ------------------------------------------------------------ trees, bushes, flowers
  const spots: { p: XY; s: number; kind: "tree" | "bush" | "flower" }[] = [];
  const clear = (p: XY, rad: number) =>
    Math.hypot(p[0] - green[0], p[1] - green[1]) > hole.greenRadius + rad && Math.hypot(p[0] - tee[0], p[1] - tee[1]) > rad + 22; // keep the tee camera clear
  for (let s = 10; s < total + 30; s += 7) {
    const p = pointAlong(line, Math.min(s, total));
    const q = pointAlong(line, Math.min(s + 3, total));
    const dx = q[0] - p[0] || 1e-6, dy = q[1] - p[1], len = Math.hypot(dx, dy);
    for (const side of [-1, 1]) {
      const lat = 34 + r() * 26;
      const t: XY = [p[0] + (-dy / len) * lat * side + (r() - 0.5) * 6, p[1] + (dx / len) * lat * side + (r() - 0.5) * 6];
      if (nearest(line, t).off > 30 && clear(t, 14)) spots.push({ p: t, s: 0.8 + r() * 0.7, kind: r() < 0.82 ? "tree" : "bush" });
      if (r() < 0.6) {
        const f: XY = [p[0] + (-dy / len) * (24 + r() * 6) * side, p[1] + (dx / len) * (24 + r() * 6) * side];
        if (clear(f, 6)) spots.push({ p: f, s: 1, kind: "flower" });
      }
    }
  }
  for (let i = 0; i < 260; i++) {
    const t: XY = [minX + r() * W, minY + r() * H];
    if (nearest(line, t).off > 70 && clear(t, 20)) spots.push({ p: t, s: 0.9 + r() * 0.9, kind: "tree" });
  }
  const trees = spots.filter((x) => x.kind === "tree"), bushes = spots.filter((x) => x.kind === "bush"), flowers = spots.filter((x) => x.kind === "flower");
  const trunk = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.28, 0.42, 2.6, 7)), keep(toon("#9a6a45")), trees.length);
  const crown = new THREE.InstancedMesh(keep(faceted(new THREE.IcosahedronGeometry(2.6, 1))), keep(toon(0xffffff)), trees.length);
  const bush = new THREE.InstancedMesh(keep(faceted(new THREE.IcosahedronGeometry(1.2, 1))), keep(toon(0xffffff)), Math.max(bushes.length, 1));
  const bloom = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(0.28, 8, 6)), keep(toon(0xffffff)), Math.max(flowers.length * 5, 1));
  const leafy = ["#46a957", "#3e9b4f", "#56b862", "#2f8a4a", "#5cbf69"], fancy = ["#f7a8c4", "#f5b84a", "#ffd166"];
  const blooms = ["#ff7aa2", "#ffd166", "#ffffff", "#b388ff", "#ff9f6e"];
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  trees.forEach((t, i) => {
    const y = heightAt(t.p);
    m4.compose(toV3(t.p, y + 1.2 * t.s), q4.identity(), sc.set(t.s, t.s, t.s));
    trunk.setMatrixAt(i, m4);
    q4.setFromAxisAngle(up, r() * Math.PI);
    m4.compose(toV3(t.p, y + 4 * t.s), q4, sc.set(t.s, t.s * (0.9 + r() * 0.3), t.s));
    crown.setMatrixAt(i, m4);
    crown.setColorAt(i, new THREE.Color(r() < 0.08 ? fancy[Math.floor(r() * fancy.length)] : leafy[Math.floor(r() * leafy.length)]));
  });
  bushes.forEach((b, i) => {
    m4.compose(toV3(b.p, heightAt(b.p) + 0.6), q4.identity(), sc.set(b.s, b.s * 0.8, b.s));
    bush.setMatrixAt(i, m4);
    bush.setColorAt(i, new THREE.Color(leafy[Math.floor(r() * leafy.length)]));
  });
  let k = 0;
  flowers.forEach((f) => {
    const col = new THREE.Color(blooms[Math.floor(r() * blooms.length)]);
    for (let j = 0; j < 5; j++, k++) {
      const p: XY = [f.p[0] + (r() - 0.5) * 2.4, f.p[1] + (r() - 0.5) * 2.4];
      m4.compose(toV3(p, heightAt(p) + 0.2), q4.identity(), sc.setScalar(0.7 + r() * 0.6));
      bloom.setMatrixAt(k, m4);
      bloom.setColorAt(k, col);
    }
  });
  bush.count = bushes.length;
  bloom.count = k;
  scene.add(trunk, crown, bush, bloom);

  // ------------------------------------------------------------ sky, clouds, light
  const skyMat = keep(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color("#5fb6ff") }, horizon: { value: new THREE.Color("#e6f6ff") } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, h), 1.0); }",
  }));
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(900, 24, 12)), skyMat);
  sky.position.set((minX + maxX) / 2, 0, -(minY + maxY) / 2);
  scene.add(sky);
  scene.fog = new THREE.Fog("#e6f6ff", 260, 900);
  scene.add(new THREE.HemisphereLight("#dff2ff", "#6fb85a", 1.25));
  const sun = new THREE.DirectionalLight("#fff4d6", 1.5);
  sun.position.set(-80, 160, 60);
  scene.add(sun);

  const cloudGeo = keep(faceted(new THREE.IcosahedronGeometry(6, 1))), cloudMat = keep(toon("#ffffff"));
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      puff.position.set(j * 7 - 10, Math.sin(j * 1.7) * 2, (r() - 0.5) * 5);
      puff.scale.setScalar(0.7 + r() * 0.6);
      g.add(puff);
    }
    // Out in the distant sky, never hanging over the player.
    const a = r() * Math.PI * 2, far = 260 + r() * 200;
    g.position.set((minX + maxX) / 2 + Math.cos(a) * far, 95 + r() * 50, -(minY + maxY) / 2 + Math.sin(a) * far);
    g.scale.setScalar(1.6 + r());
    clouds.push(g);
    scene.add(g);
  }

  // ------------------------------------------------------------ aim ring
  const aimRing = new THREE.Mesh(keep(new THREE.RingGeometry(1.6, 2.2, 32)), keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false })));
  aimRing.rotation.x = -Math.PI / 2;
  aimRing.renderOrder = 2;
  scene.add(aimRing);

  const fp = flagGeo.attributes.position as THREE.BufferAttribute;
  return {
    scene,
    heightAt,
    cup: toV3(green, gY + 0.12),
    aimRing,
    flagstick,
    update(t) {
      for (let i = 0; i < fp.count; i++) {
        const x = flagBase[i * 3];
        fp.setZ(i, Math.sin(t * 5 + x * 3) * 0.12 * x);
      }
      fp.needsUpdate = true;
      clouds.forEach((g, i) => {
        g.position.x += 0.02 + i * 0.002;
        if (g.position.x > maxX + 500) g.position.x = minX - 500;
      });
      const s = 1 + Math.sin(t * 4) * 0.08;
      aimRing.scale.set(s, s, s);
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
      toonRamp?.dispose();
      toonRamp = null;
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
