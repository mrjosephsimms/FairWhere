// A Mii-style golfer (big head, cap in the player's colour, simple face) with idle,
// walk, swing, putt, celebrate and sad animations, all driven by code (no assets).
// Clubs look different: a big round driver head, a wood, a blade iron, a wedge,
// a flat putter.
//
// Local frame: the golfer faces +Z (toward the ball) and the target is +X (their left,
// like a right-hander). Place with `stand(ball, dir)`.
import * as THREE from "three";
import type { Club } from "../lib/game";
import { paint } from "./world";

export type Move = "idle" | "walk" | "swing" | "putt" | "celebrate" | "sad";

/** Seconds from the start of a move to club-on-ball. */
export const IMPACT = { swing: 0.78, putt: 0.62 };

export interface Golfer {
  root: THREE.Group;
  /** Stand at the ball, facing it, with the target along `dir` (unit, world XZ). */
  stand: (ball: THREE.Vector3, dir: THREE.Vector3) => void;
  /** Where the golfer would stand to hit `ball` toward `dir` (and which way they'd face). */
  stance: (ball: THREE.Vector3, dir: THREE.Vector3) => { pos: THREE.Vector3; yaw: number };
  setClub: (kind: Club["kind"]) => void;
  /** Pose for time t (s) in the current move. Returns true at the moment of impact. */
  pose: (move: Move, t: number, dt: number) => boolean;
  dispose: () => void;
}

export function makeGolfer(shirt: string): Golfer {
  const root = new THREE.Group();
  const body = new THREE.Group(); // twists during the swing, bobs while walking
  root.add(body);
  const geos: THREE.BufferGeometry[] = [];
  const g = <T extends THREE.BufferGeometry>(x: T) => (geos.push(x), x);
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(g(geo), mat);
    m.castShadow = true;
    return m;
  };
  const skin = paint("#ffd9bd", 0.7), shirtM = paint(shirt, 0.8), pants = paint("#33405f", 0.9), shoes = paint("#f4f4f4", 0.6);
  const capM = paint(new THREE.Color(shirt).multiplyScalar(0.72), 0.7), dark = new THREE.MeshBasicMaterial({ color: 0x1d1d24 });

  // legs pivot at the hips so they can stride
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0.14 * side, 0.55, 0);
    const leg = mesh(new THREE.CapsuleGeometry(0.105, 0.34, 4, 10), pants);
    leg.position.y = -0.24;
    const shoe = mesh(new THREE.SphereGeometry(0.125, 14, 10), shoes);
    shoe.scale.set(1, 0.6, 1.45);
    shoe.position.set(0, -0.48, 0.05);
    hip.add(leg, shoe);
    root.add(hip);
    legs.push(hip);
  }
  // torso
  const torso = mesh(new THREE.CapsuleGeometry(0.26, 0.3, 6, 16), shirtM);
  torso.position.y = 0.84;
  body.add(torso);
  // head: smooth Mii-ish face
  const head = new THREE.Group();
  head.position.y = 1.43;
  head.add(mesh(new THREE.SphereGeometry(0.38, 28, 20), skin));
  const eyes: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(g(new THREE.SphereGeometry(0.05, 12, 10)), dark);
    eye.scale.set(0.85, 1.3, 0.5);
    eye.position.set(0.13 * side, 0.04, 0.355);
    const brow = new THREE.Mesh(g(new THREE.BoxGeometry(0.09, 0.018, 0.02)), dark);
    brow.position.set(0.13 * side, 0.15, 0.35);
    brow.rotation.z = -0.12 * side;
    head.add(eye, brow);
    eyes.push(eye);
  }
  const nose = mesh(new THREE.SphereGeometry(0.045, 10, 8), skin);
  nose.position.set(0, -0.03, 0.38);
  const smile = new THREE.Mesh(g(new THREE.TorusGeometry(0.055, 0.011, 6, 16, Math.PI)), dark);
  smile.position.set(0, -0.13, 0.355);
  smile.rotation.z = Math.PI;
  head.add(nose, smile);
  // cap: dome + bill
  const dome = mesh(new THREE.SphereGeometry(0.4, 26, 12, 0, Math.PI * 2, 0, Math.PI / 2), capM);
  dome.position.y = 0.06;
  const bill = mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.04, 22, 1, false, -Math.PI / 2, Math.PI), capM);
  bill.position.set(0, 0.07, 0.29);
  bill.scale.set(1, 1, 0.85);
  head.add(dome, bill);
  body.add(head);

  // arms + club hang from the shoulders, tilted toward the ball, swinging in that plane
  const shoulders = new THREE.Group();
  shoulders.position.set(0, 1.02, 0.05);
  shoulders.rotation.x = -0.62; // lean the swing plane over the ball
  body.add(shoulders);
  const swingArm = new THREE.Group(); // rotates about local Z
  shoulders.add(swingArm);
  for (const side of [-1, 1]) {
    const arm = mesh(new THREE.CapsuleGeometry(0.072, 0.42, 4, 8), shirtM);
    arm.position.set(0.1 * side, -0.27, 0);
    arm.rotation.z = -0.24 * side;
    swingArm.add(arm);
  }
  const glove = mesh(new THREE.SphereGeometry(0.085, 12, 10), paint("#ffffff", 0.6));
  glove.position.y = -0.55;
  swingArm.add(glove);

  // The club: shaft + a head that changes with the club in hand.
  const metal = paint("#c9ced6", 0.35, 0.6), clubDark = paint("#2a2f3a", 0.35, 0.4), steel = paint("#dfe3ea", 0.25, 0.8);
  const shaft = mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 6), metal);
  const heads: Record<Club["kind"], THREE.Object3D> = {
    driver: mesh(new THREE.SphereGeometry(0.15, 16, 12), clubDark),
    wood: mesh(new THREE.SphereGeometry(0.115, 14, 10), clubDark),
    iron: mesh(new THREE.BoxGeometry(0.2, 0.11, 0.04), steel),
    wedge: mesh(new THREE.BoxGeometry(0.18, 0.13, 0.045), steel),
    putter: mesh(new THREE.BoxGeometry(0.26, 0.07, 0.11), steel),
  };
  heads.driver.scale.set(1.3, 0.7, 1);
  heads.wood.scale.set(1.25, 0.7, 1);
  heads.wedge.rotation.x = -0.5;
  Object.values(heads).forEach((h) => swingArm.add(h));
  let shaftLen = 0.78;
  const setClub = (kind: Club["kind"]) => {
    shaftLen = kind === "driver" ? 0.92 : kind === "wood" ? 0.86 : kind === "putter" ? 0.6 : 0.78;
    shaft.scale.y = shaftLen;
    shaft.position.y = -0.55 - shaftLen / 2;
    for (const [k, h] of Object.entries(heads)) {
      h.visible = k === kind;
      h.position.set(0.06, -0.55 - shaftLen - 0.02, 0);
    }
  };
  swingArm.add(shaft);
  setClub("iron");

  let blinkAt = 2, impactDone = false;
  const ease = (x: number) => x * x * (3 - 2 * x);

  const stance = (ball: THREE.Vector3, dir: THREE.Vector3) => {
    const facing = new THREE.Vector3(-dir.z, 0, dir.x); // +Z_local, so that +X_local is the target
    return { pos: ball.clone().addScaledVector(facing, -0.95), yaw: Math.atan2(facing.x, facing.z) };
  };

  return {
    root,
    stance,
    stand(ball, dir) {
      const s = stance(ball, dir);
      root.position.copy(s.pos);
      root.rotation.y = s.yaw;
    },
    setClub,
    pose(move, t, dt) {
      blinkAt -= dt;
      const blink = blinkAt < 0.12 && blinkAt > 0;
      eyes.forEach((e) => (e.scale.y = blink ? 0.15 : 1.3));
      if (blinkAt < 0) blinkAt = 2 + Math.random() * 3;

      body.position.y = 0;
      body.rotation.set(0, 0, 0);
      head.rotation.set(0, 0, 0);
      legs.forEach((l) => (l.rotation.x = 0));
      shoulders.rotation.x = -0.62;
      let a = 0, hit = false; // club angle in the swing plane: - = back, + = through

      if (move === "idle") {
        body.position.y = Math.sin(t * 2.4) * 0.02;
        a = Math.sin(t * 2.4) * 0.08; // little waggle
      } else if (move === "walk") {
        const stride = Math.sin(t * 9);
        legs[0].rotation.x = stride * 0.55;
        legs[1].rotation.x = -stride * 0.55;
        body.position.y = Math.abs(Math.cos(t * 9)) * 0.06;
        shoulders.rotation.x = -0.15; // club carried by the side
        a = 0.25 + stride * 0.12;
      } else if (move === "swing") {
        if (t < 0.05) impactDone = false;
        const back = 0.62, down = IMPACT.swing;
        if (t < back) a = -2.1 * ease(t / back);
        else if (t < down) a = -2.1 + (2.1 * (t - back)) / (down - back);
        else a = Math.min(2.4, ((t - down) / 0.35) * 2.4);
        body.rotation.y = a * 0.22;
        head.rotation.y = -a * 0.12;
        if (t >= down && !impactDone) hit = impactDone = true;
      } else if (move === "putt") {
        if (t < 0.05) impactDone = false;
        const back = 0.42, down = IMPACT.putt;
        if (t < back) a = -0.45 * ease(t / back);
        else if (t < down) a = -0.45 + (0.45 * (t - back)) / (down - back);
        else a = Math.min(0.5, ((t - down) / 0.3) * 0.5);
        if (t >= down && !impactDone) hit = impactDone = true;
      } else if (move === "celebrate") {
        body.position.y = Math.abs(Math.sin(t * 7)) * 0.45;
        legs.forEach((l, i) => (l.rotation.x = Math.abs(Math.sin(t * 7)) * 0.3 * (i ? 1 : -1)));
        a = 2.8 + Math.sin(t * 14) * 0.2; // club raised high
        body.rotation.y = Math.sin(t * 7) * 0.3;
      } else if (move === "sad") {
        head.rotation.x = 0.35;
        body.position.y = -0.04;
        a = 0.05;
      }
      if (move !== "swing" && move !== "putt") impactDone = false;
      swingArm.rotation.z = a;
      return hit;
    },
    dispose() {
      geos.forEach((x) => x.dispose());
    },
  };
}
