// Runs the 3D show: render loop, camera moves, ball flight/bounce/roll, golfer
// animation, confetti. The rules live in lib/game.ts; the React screen
// (HoleGame.tsx) tells the director what happened and it animates it.
import * as THREE from "three";
import type { GameHole, Shot, XY } from "../lib/game";
import { buildWorld, toV3, toon, type World } from "./world";
import { IMPACT, makeGolfer, type Golfer, type Move } from "./golfer";
import { sfx } from "./sfx";

const BALL_R = 0.2; // cartoon-sized so you can actually see it
const TRAIL_MAX = 70;
const up = new THREE.Vector3(0, 1, 0);
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

interface Flight {
  kind: "air" | "putt";
  from: THREE.Vector3;
  land: THREE.Vector3;
  to: THREE.Vector3;
  apex: number;
  dur: number;
  t: number;
  lost: boolean;
  holed: boolean;
  landed: boolean;
  onEnd: () => void;
}

type Cam = "intro" | "address" | "follow" | "celebrate";

export class Director {
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2500);
  private world: World;
  private golfer: Golfer;
  private ball = new THREE.Group();
  private ballShadow: THREE.Mesh;
  private trail: THREE.Line;
  private trailPts: THREE.Vector3[] = [];
  /** Fixed buffer, filled in place: growing a geometry each frame makes three.js warn. */
  private trailBuf = new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3);
  private poof: THREE.Mesh;
  private confetti: THREE.InstancedMesh;
  private bits: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; s: number }[] = [];
  private raf = 0;
  private last = 0;
  private clock = 0;
  private move: Move = "idle";
  private moveT = 0;
  private cam: Cam = "intro";
  private camT = 0;
  private dir = new THREE.Vector3(1, 0, 0);
  private putting = false;
  private flight: Flight | null = null;
  private pendingShot: (() => void) | null = null;
  private lookAt = new THREE.Vector3();
  private introFrom = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private timers: { at: number; fn: () => void }[] = [];
  private poofT = -1;
  private ringScale = 1;
  private introDone: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, hole: GameHole, shirt: string) {
    // preserveDrawingBuffer lets screenshots (and the dev preview) capture frames.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.world = buildWorld(hole);
    this.golfer = makeGolfer(shirt);
    this.world.scene.add(this.golfer.root);

    const ballGeo = new THREE.SphereGeometry(BALL_R, 20, 14);
    const shell = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0x1f2a22, side: THREE.BackSide }));
    shell.scale.setScalar(1.12);
    this.ball.add(new THREE.Mesh(ballGeo, toon("#ffffff")), shell);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.2, 16), new THREE.MeshBasicMaterial({ color: 0x0b2a12, transparent: true, opacity: 0.3, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", this.trailBuf);
    trailGeo.setDrawRange(0, 0);
    this.trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    this.trail.frustumCulled = false;
    this.poof = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.25, 0.12), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 140);
    this.confetti.count = 0;
    this.confetti.frustumCulled = false; // its bounds were computed while empty at the origin
    this.world.scene.add(this.ball, this.ballShadow, this.trail, this.poof, this.confetti);

    // Intro starts high over the green, looking back down the hole.
    const cup = this.world.cup, tee = toV3(hole.line[0]);
    const back = cup.clone().sub(tee).setY(0).normalize();
    this.introFrom.pos.copy(cup).addScaledVector(back, 35).add(new THREE.Vector3(0, 55, 0));
    this.introFrom.look.copy(cup).lerp(tee, 0.5);
    this.camera.position.copy(this.introFrom.pos);
    this.lookAt.copy(this.introFrom.look);
  }

  start() {
    const loop = (now: number) => {
      const dt = Math.min((now - (this.last || now)) / 1000, 0.05);
      this.last = now;
      this.tick(dt);
      this.renderer.render(this.world.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.world.dispose();
    this.golfer.dispose();
    this.renderer.dispose();
  }

  private ground(p: THREE.Vector3) {
    return this.world.heightAt([p.x, -p.z]);
  }

  private onGround(xy: XY, lift = BALL_R) {
    return toV3(xy, this.world.heightAt(xy) + lift);
  }

  private after(sec: number, fn: () => void) {
    this.timers.push({ at: this.clock + sec, fn });
  }

  /** Fly in from over the green to the golfer on the tee. Tapping skips it (skipIntro). */
  intro(done: () => void) {
    this.cam = "intro";
    this.camT = 0;
    this.introDone = done;
    this.after(3.3, () => this.endIntro());
  }

  skipIntro() {
    if (this.cam === "intro") {
      const { pos, look } = this.addressShot(); // cut straight to the golfer
      this.camera.position.copy(pos);
      this.lookAt.copy(look);
      this.camera.lookAt(look);
    }
    this.endIntro();
  }

  private endIntro() {
    const done = this.introDone;
    this.introDone = null;
    if (!done) return;
    if (this.cam === "intro") this.cam = "address";
    done();
  }

  /** Put the ball and golfer at `ball`, aimed at `aim`. `cut` snaps the camera. */
  setUp(ballXY: XY, aimXY: XY, putting: boolean, cut: boolean) {
    this.putting = putting;
    const b = this.onGround(ballXY);
    this.ball.position.copy(b);
    this.ball.visible = true;
    this.dir.copy(toV3(aimXY).sub(toV3(ballXY)).setY(0).normalize());
    this.golfer.stand(b.clone().setY(this.ground(b)), this.dir);
    this.golfer.root.position.y = this.world.heightAt([this.golfer.root.position.x, -this.golfer.root.position.z]);
    const ringAt = putting ? this.world.cup.clone() : this.onGround(aimXY, 0.15);
    this.world.aimRing.position.copy(ringAt).setY(ringAt.y + (putting ? 0.02 : 0));
    this.world.aimRing.visible = true;
    this.world.flagstick.visible = !putting;
    this.ringScale = putting ? 0.32 : 1;
    this.trailPts = [];
    this.trail.geometry.setDrawRange(0, 0);
    this.setMove("idle");
    if (this.cam !== "intro") this.cam = "address";
    if (cut) {
      const { pos, look } = this.addressShot();
      this.camera.position.copy(pos);
      this.lookAt.copy(look);
    }
  }

  /**
   * Behind the ball on the target line, nudged away from the golfer so they stand
   * left of centre, and aimed low enough that the ball sits above the swing meter.
   */
  private addressShot() {
    const b = this.ball.position;
    const back = this.putting ? 7 : 9, high = this.putting ? 3.4 : 3.8;
    const awayFromGolfer = new THREE.Vector3(-this.dir.z, 0, this.dir.x).multiplyScalar(this.putting ? 1.4 : 1.1);
    const pos = b.clone().addScaledVector(this.dir, -back).add(awayFromGolfer).add(new THREE.Vector3(0, high, 0));
    const look = this.putting
      ? b.clone().lerp(this.world.cup, 0.5).add(new THREE.Vector3(0, -0.6, 0))
      : b.clone().addScaledVector(this.dir, 12).add(new THREE.Vector3(0, -0.5, 0));
    return { pos, look };
  }

  /** Swing (or putt); the ball leaves at impact and `landed` fires when it comes to rest. */
  shoot(shot: Shot, holed: boolean, landed: () => void) {
    const putt = this.putting;
    this.world.aimRing.visible = false;
    this.setMove(putt ? "putt" : "swing");
    if (!putt) this.after(0.45, () => sfx.whoosh());
    const from = this.ball.position.clone();
    const lost = shot.result === "lost";
    const to = this.onGround(shot.to);
    const dist = from.distanceTo(to);
    const land = putt || lost ? to.clone() : from.clone().lerp(to, dist > 60 ? 0.86 : 0.78);
    land.y = this.ground(land) + BALL_R;
    this.pendingShot = () => {
      putt ? sfx.putt() : sfx.hit();
      this.flight = {
        kind: putt ? "putt" : "air",
        from, land, to,
        apex: putt ? 0 : Math.min(Math.max(dist * 0.17, 4), 34),
        dur: putt ? 0.8 + dist * 0.09 : 1.0 + dist / 140,
        t: 0, lost, holed, landed: false,
        onEnd: landed,
      };
      if (!putt) this.cam = "follow";
    };
  }

  celebrate() {
    this.setMove("celebrate");
    this.cam = "celebrate";
    this.camT = 0;
    sfx.jingle();
    const c = this.golfer.root.position;
    const palette = ["#ff5a5f", "#ffd166", "#3478f6", "#2fbf71", "#b388ff", "#ff9f6e"];
    this.bits = Array.from({ length: 140 }, () => ({
      p: c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 2 + Math.random(), (Math.random() - 0.5) * 2)),
      v: new THREE.Vector3((Math.random() - 0.5) * 6, 5 + Math.random() * 6, (Math.random() - 0.5) * 6),
      r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0),
      s: 0.8 + Math.random() * 0.8,
    }));
    this.bits.forEach((_, i) => this.confetti.setColorAt(i, new THREE.Color(palette[i % palette.length])));
    this.confetti.count = this.bits.length;
  }

  sad() {
    this.setMove("sad");
    sfx.aww();
  }

  private setMove(m: Move) {
    this.move = m;
    this.moveT = 0;
  }

  private tick(dt: number) {
    this.clock += dt;
    this.moveT += dt;
    this.camT += dt;
    this.world.update(this.clock);
    this.world.aimRing.scale.multiplyScalar(this.ringScale);
    for (const t of this.timers.filter((x) => x.at <= this.clock)) t.fn();
    this.timers = this.timers.filter((x) => x.at > this.clock);

    if (this.golfer.pose(this.move, this.moveT, dt) && this.pendingShot) {
      this.pendingShot();
      this.pendingShot = null;
    }
    if ((this.move === "swing" && this.moveT > IMPACT.swing + 0.9) || (this.move === "putt" && this.moveT > IMPACT.putt + 0.8)) this.setMove("idle");

    this.stepFlight(dt);
    this.stepConfetti(dt);
    if (this.poofT >= 0) {
      this.poofT += dt;
      const k = this.poofT / 0.6;
      this.poof.scale.setScalar(0.5 + k * 3);
      (this.poof.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) this.poofT = -1;
    }

    const g = this.ground(this.ball.position);
    this.ballShadow.position.set(this.ball.position.x, g + 0.05, this.ball.position.z);
    this.ballShadow.visible = this.ball.visible;
    this.stepCamera(dt);
  }

  private stepFlight(dt: number) {
    const f = this.flight;
    if (!f) return;
    f.t += dt;
    const p = this.ball.position;
    if (f.kind === "putt") {
      const k = Math.min(f.t / f.dur, 1), e = 1 - (1 - k) * (1 - k);
      p.lerpVectors(f.from, f.to, e);
      p.y = this.ground(p) + BALL_R;
      if (k >= 1 && f.holed) {
        const sink = Math.min((f.t - f.dur) / 0.25, 1);
        p.copy(this.world.cup).setY(this.world.cup.y + BALL_R - sink * 0.5);
        if (!f.landed) (f.landed = true, sfx.cup());
        if (sink >= 1) this.endFlight();
      } else if (k >= 1) this.endFlight();
      return;
    }
    if (f.t < f.dur) {
      const k = f.t / f.dur;
      p.lerpVectors(f.from, f.land, k);
      p.y = f.from.y + (f.land.y - f.from.y) * k + f.apex * 4 * k * (1 - k);
      this.trailPts.push(p.clone());
      if (this.trailPts.length > TRAIL_MAX) this.trailPts.shift();
      this.trailPts.forEach((q, i) => this.trailBuf.setXYZ(i, q.x, q.y, q.z));
      this.trailBuf.needsUpdate = true;
      this.trail.geometry.setDrawRange(0, this.trailPts.length);
      return;
    }
    if (f.lost) {
      if (!f.landed) {
        f.landed = true;
        this.ball.visible = false;
        this.poof.position.copy(f.land).setY(f.land.y + 1.5);
        this.poofT = 0;
      }
      if (f.t > f.dur + 0.7) this.endFlight();
      return;
    }
    if (!f.landed) (f.landed = true, sfx.land());
    const bounceDur = 0.7, u = Math.min((f.t - f.dur) / bounceDur, 1);
    p.lerpVectors(f.land, f.to, 1 - (1 - u) * (1 - u));
    const hop = u < 0.55 ? Math.sin((Math.PI * u) / 0.55) * f.apex * 0.09 : Math.sin((Math.PI * (u - 0.55)) / 0.45) * f.apex * 0.025;
    p.y = this.ground(p) + BALL_R + hop;
    if (u >= 1) this.endFlight();
  }

  private endFlight() {
    const f = this.flight!;
    this.flight = null;
    // Linger on where it finished, then hand back.
    this.after(f.kind === "putt" ? 0.5 : 0.9, f.onEnd);
  }

  private stepConfetti(dt: number) {
    if (!this.confetti.count) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    this.bits.forEach((b, i) => {
      b.v.y -= 9 * dt;
      b.v.multiplyScalar(0.985);
      b.p.addScaledVector(b.v, dt);
      b.r.x += dt * 6;
      b.r.y += dt * 4;
      m.compose(b.p, q.setFromEuler(b.r), s.setScalar(b.s));
      this.confetti.setMatrixAt(i, m);
    });
    this.confetti.instanceMatrix.needsUpdate = true;
    if (this.confetti.instanceColor) this.confetti.instanceColor.needsUpdate = true;
  }

  private stepCamera(dt: number) {
    let pos: THREE.Vector3, look: THREE.Vector3, rate = 3.5;
    if (this.cam === "intro") {
      const k = ease(Math.min(this.camT / 3.2, 1));
      const a = this.addressShot();
      pos = this.introFrom.pos.clone().lerp(a.pos, k);
      look = this.introFrom.look.clone().lerp(a.look, k);
      this.camera.position.copy(pos);
      this.keepAboveGround();
      this.lookAt.copy(look);
      this.camera.lookAt(this.lookAt);
      if (this.camT >= 3.2) this.cam = "address";
      return;
    }
    if (this.cam === "follow") {
      const b = this.ball.position, f = this.flight;
      const heading = f ? f.land.clone().sub(f.from).setY(0).normalize() : this.dir;
      // Ride behind the ball, looking a little ahead so you see where it's going.
      pos = b.clone().addScaledVector(heading, -14).add(new THREE.Vector3(0, 5.5, 0));
      look = b.clone().addScaledVector(heading, 16);
      look.y = (b.y + this.ground(look)) / 2;
      rate = 4.5;
    } else if (this.cam === "celebrate") {
      const c = this.golfer.root.position, a = this.camT * 0.5;
      pos = c.clone().add(new THREE.Vector3(Math.cos(a) * 6, 2.8, Math.sin(a) * 6));
      look = c.clone().add(up.clone().multiplyScalar(1.1));
      rate = 2.5;
    } else {
      ({ pos, look } = this.addressShot());
    }
    const k = 1 - Math.exp(-dt * rate);
    this.camera.position.lerp(pos, k);
    this.keepAboveGround();
    this.lookAt.lerp(look, k);
    this.camera.lookAt(this.lookAt);
  }

  /** Straight-line camera moves can cut through hills; never let the lens go underground. */
  private keepAboveGround() {
    const floor = this.ground(this.camera.position) + 1.6;
    if (this.camera.position.y < floor) this.camera.position.y = floor;
  }
}
