// A chibi golfer (big head, cap, blinking eyes, cartoon outline) with idle, swing,
// putt and celebrate animations, all driven by code so there are no asset files.
//
// Local frame: the golfer faces +Z (toward the ball) and the target is +X (their left,
// like a right-hander). Place with `stand(ball, dir)`.
import * as THREE from "three";
import { toon } from "./world";

const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x1f2a22, side: THREE.BackSide });

/** Mesh plus a slightly bigger back-face copy: the classic cartoon outline. */
function inked(geo: THREE.BufferGeometry, mat: THREE.Material, width = 1.07) {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(geo, OUTLINE);
  shell.scale.setScalar(width);
  g.add(new THREE.Mesh(geo, mat), shell);
  return g;
}

export interface Golfer {
  root: THREE.Group;
  /** Stand at the ball, facing it, with the target along `dir` (unit, world XZ). */
  stand: (ball: THREE.Vector3, dir: THREE.Vector3) => void;
  /** Pose for time t (s) in the current move. Returns true at the moment of impact. */
  pose: (move: Move, t: number, dt: number) => boolean;
  dispose: () => void;
}

export type Move = "idle" | "swing" | "putt" | "celebrate" | "sad";

/** Seconds from the start of a move to club-on-ball. */
export const IMPACT = { swing: 0.78, putt: 0.62 };

export function makeGolfer(shirt: string): Golfer {
  const root = new THREE.Group();
  const body = new THREE.Group(); // twists during the swing
  root.add(body);
  const geos: THREE.BufferGeometry[] = [];
  const g = <T extends THREE.BufferGeometry>(x: T) => (geos.push(x), x);
  const skin = toon("#ffd9bd"), shirtM = toon(shirt), pants = toon("#3d4b6e"), shoes = toon("#ffffff"), capM = toon(new THREE.Color(shirt).multiplyScalar(0.75)), dark = new THREE.MeshBasicMaterial({ color: 0x1d1d24 });

  // legs + shoes
  for (const side of [-1, 1]) {
    const leg = inked(g(new THREE.CapsuleGeometry(0.11, 0.32, 4, 10)), pants);
    leg.position.set(0.15 * side, 0.32, 0);
    const shoe = inked(g(new THREE.SphereGeometry(0.13, 12, 8)), shoes);
    shoe.scale.set(1, 0.6, 1.4);
    shoe.position.set(0.15 * side, 0.08, 0.05);
    root.add(leg, shoe);
  }
  // torso
  const torso = inked(g(new THREE.CapsuleGeometry(0.27, 0.28, 6, 14)), shirtM);
  torso.position.y = 0.82;
  body.add(torso);
  // head
  const head = new THREE.Group();
  head.position.y = 1.42;
  head.add(inked(g(new THREE.SphereGeometry(0.4, 24, 18)), skin, 1.05));
  const eyes: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(g(new THREE.SphereGeometry(0.055, 12, 10)), dark);
    eye.scale.set(1, 1.35, 0.6);
    eye.position.set(0.14 * side, 0.03, 0.37);
    const shine = new THREE.Mesh(g(new THREE.SphereGeometry(0.018, 8, 6)), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    shine.position.set(0.02, 0.03, 0.04);
    eye.add(shine);
    const cheek = new THREE.Mesh(g(new THREE.CircleGeometry(0.06, 16)), new THREE.MeshBasicMaterial({ color: 0xff9aa8, transparent: true, opacity: 0.6 }));
    cheek.position.set(0.23 * side, -0.09, 0.33);
    cheek.lookAt(cheek.position.clone().multiplyScalar(3));
    head.add(eye, cheek);
    eyes.push(eye);
  }
  const smile = new THREE.Mesh(g(new THREE.TorusGeometry(0.06, 0.012, 6, 16, Math.PI)), dark);
  smile.position.set(0, -0.11, 0.38);
  smile.rotation.z = Math.PI;
  head.add(smile);
  // cap: dome + bill
  const dome = inked(g(new THREE.SphereGeometry(0.42, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2)), capM, 1.04);
  dome.position.y = 0.06;
  const bill = new THREE.Mesh(g(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 20, 1, false, -Math.PI / 2, Math.PI)), capM);
  bill.position.set(0, 0.07, 0.3);
  bill.scale.set(1, 1, 0.8);
  head.add(dome, bill);
  body.add(head);

  // arms + club hang from the shoulders, tilted toward the ball, swinging in that plane
  const shoulders = new THREE.Group();
  shoulders.position.set(0, 1.0, 0.05);
  shoulders.rotation.x = -0.62; // lean the swing plane over the ball
  body.add(shoulders);
  const swingArm = new THREE.Group(); // rotates about local Z
  shoulders.add(swingArm);
  for (const side of [-1, 1]) {
    const arm = inked(g(new THREE.CapsuleGeometry(0.075, 0.42, 4, 8)), shirtM);
    arm.position.set(0.11 * side, -0.27, 0);
    arm.rotation.z = -0.25 * side;
    swingArm.add(arm);
  }
  const hands = inked(g(new THREE.SphereGeometry(0.09, 12, 10)), toon("#ffffff"));
  hands.position.y = -0.55;
  const shaft = new THREE.Mesh(g(new THREE.CylinderGeometry(0.02, 0.02, 0.78, 6)), toon("#c9ced6"));
  shaft.position.y = -0.94;
  const clubHead = inked(g(new THREE.BoxGeometry(0.2, 0.09, 0.08)), toon("#5b6270"));
  clubHead.position.set(0.05, -1.33, 0);
  swingArm.add(hands, shaft, clubHead);

  const shadow = new THREE.Mesh(g(new THREE.CircleGeometry(0.55, 24)), new THREE.MeshBasicMaterial({ color: 0x0b2a12, transparent: true, opacity: 0.25, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  root.add(shadow);

  let blinkAt = 2, impactDone = false;
  const ease = (x: number) => x * x * (3 - 2 * x);

  return {
    root,
    stand(ball, dir) {
      const facing = new THREE.Vector3(-dir.z, 0, dir.x); // +Z_local, so that +X_local is the target
      root.position.copy(ball).addScaledVector(facing, -0.95);
      root.rotation.y = Math.atan2(facing.x, facing.z);
    },
    pose(move, t, dt) {
      // blink every few seconds
      blinkAt -= dt;
      const blink = blinkAt < 0.12 && blinkAt > 0;
      eyes.forEach((e) => (e.scale.y = blink ? 0.15 : 1.35));
      if (blinkAt < 0) blinkAt = 2 + Math.random() * 3;

      body.position.y = 0;
      body.rotation.set(0, 0, 0);
      head.rotation.set(0, 0, 0);
      let a = 0, hit = false; // club angle in the swing plane: - = back, + = through

      if (move === "idle") {
        body.position.y = Math.sin(t * 2.4) * 0.025;
        a = Math.sin(t * 2.4) * 0.08; // little waggle
        impactDone = false;
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
        const hop = Math.abs(Math.sin(t * 7));
        body.position.y = hop * 0.45;
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
