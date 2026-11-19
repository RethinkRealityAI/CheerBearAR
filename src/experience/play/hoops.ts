// Heart Hoops (from Bobo Hoops): Cheer Bear floats a rainbow ring and you get 10 hearts to throw through it with a
// swipe up (the heart toss's flick gesture and its toy physics: the same pooled hearts, the same solver).
//
//   through the ring = 2, clean through without touching it (a swish) = 3, a long shot +1, from the 3rd in a row +1,
//   the 10th heart (gold sparkles) counts double. The ring moves after every heart that goes in.
//
// The swipe's lean picks the direction and its length the distance (a short swipe falls short, a long one flies
// past); there is a little aim help for small hands, less than the free toy. The ring's edge is 14 static spheres in
// the stage's toy world, so hearts really bounce off it. Everything is stage-local.
import * as THREE from 'three';
import type { PlayStatus } from '../../shared/contracts';
import type { Body } from '../physics/world';
import { PAL, RAINBOW } from '../scene/fx';
import { PlayGame, mulberry32, type PlayHost } from './game';
import { HOOP_BAND, HOOP_R, RIM_N, houseBounds } from './kit';

const BALLS = 10;
const UP = new THREE.Vector3(0, 1, 0);
/** Ring distances from you, in metres (3D: she is 0.9 m tall). */
const DIST_M = { min: 2.2, max: 4.6, arMin: 0.9, arMax: 2.4 };

interface Shot {
  b: Body;
  age: number;
  side: number;
  prev: THREE.Vector3;
  done: boolean;
  scored: boolean;
  touched: boolean;
  from: number;
  money: boolean;
  rimT: number;
}

export class HeartHoops extends PlayGame {
  readonly id = 'heart-hoops' as const;
  readonly label = 'Heart Hoops';
  readonly showStick = false;
  protected readonly roundS = null;
  protected readonly starAt = [8, 18, 28] as const;
  protected readonly balls = BALLS;
  protected readonly goLine: string;
  /** The 3D camera holds still on the court while this runs. */
  readonly view = { wide: 0.9, pitch: 0.16 as number | null, focus: true };
  readonly flicks = true;
  thrown = 0;
  resolved = 0;
  made = 0;
  swishes = 0;
  streak = 0;
  private shots: Shot[] = [];
  private last = -1e9;
  private rng = mulberry32(7);
  /** Ring centre (stage-local) and where it is going. */
  readonly ring = new THREE.Vector3();
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private moveT = 1;
  private ringK = 0;
  private dist = { min: 3, max: 5 };
  /** Her spot beside the ring. */
  private stand = new THREE.Vector3();
  private n = new THREE.Vector3(0, 0, 1);
  private right = new THREE.Vector3(1, 0, 0);
  private o = new THREE.Vector3();
  private v = new THREE.Vector3();
  private d = new THREE.Vector3();
  private t = new THREE.Vector3();
  private house = new THREE.Box3();
  private field = { x: 0, z: 0, r: 2.6 };
  private sparkT = 0;
  private cc = new THREE.Vector3();

  constructor(host: PlayHost, emit: (s: PlayStatus) => void, exit: () => void, desktop = false) {
    super(host, emit, exit);
    this.goLine = desktop ? 'Hold Space, let go to throw' : 'Swipe up through the ring!';
  }

  // ------------------------------------------------------------------ round
  protected setup(): void {
    this.rng = mulberry32((Math.random() * 4294967296) >>> 0);
    this.thrown = this.resolved = this.made = this.swishes = this.streak = 0;
    this.shots.length = 0;
    this.host.stage.play.clear();
    this.host.field(this.field);
    const u = this.host.unitsPerM, ar = this.host.variant === 'ar';
    this.dist = { min: (ar ? DIST_M.arMin : DIST_M.min) * u, max: (ar ? DIST_M.arMax : DIST_M.max) * u };
    this.pickSpot(this.to, true);
    this.ring.copy(this.to);
    this.from.copy(this.to);
    this.moveT = 1;
    this.ringK = 0;
    this.standBeside();
    this.ui.setBalls(0);
    this.ui.streak(0);
  }

  /** A new place for the ring: in front of you at a varying distance, inside the play area, clear of the house. */
  private pickSpot(out: THREE.Vector3, first = false): void {
    const st = this.host.stage;
    const cam = this.cc.copy(st.cam), f = this.d.copy(st.camDir);
    this.host.court?.(cam, f);
    f.setY(0);
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    const r = this.t.set(-f.z, 0, f.x);
    const hb = houseBounds(st, 0.5, this.house);
    const F = this.field;
    let best = -1;
    for (let i = 0; i < 40; i++) {
      const k = first ? 0.25 + this.rng() * 0.2 : this.rng();
      const dd = this.dist.min + (this.dist.max - this.dist.min) * k;
      const lat = (this.rng() * 2 - 1) * dd * 0.13;
      const x = cam.x + f.x * dd + r.x * lat, z = cam.z + f.z * dd + r.z * lat;
      if (Math.hypot(x - F.x, z - F.z) > F.r) continue;
      if (hb && x > hb.min.x - 0.2 && x < hb.max.x + 0.2 && z > hb.min.z - 0.2 && z < hb.max.z + 0.2) continue;
      // not right where it was
      if (!first && Math.hypot(x - this.ring.x, z - this.ring.z) < 0.6) continue;
      out.set(x, 0.75 + this.rng() * 0.6, z);
      best = i;
      break;
    }
    if (best < 0) {
      // nothing fits (AR: far from the stage): the field's near edge, towards you
      const dx = cam.x - F.x, dz = cam.z - F.z, l = Math.hypot(dx, dz) || 1;
      out.set(F.x + (dx / l) * F.r * 0.3, 0.9, F.z + (dz / l) * F.r * 0.3);
    }
  }

  private standBeside(): void {
    // beside the ring, on the side nearer the middle of the field, a little behind it
    this.faceBasis(this.to);
    const sgn = (this.to.x - this.field.x) * this.right.x + (this.to.z - this.field.z) * this.right.z > 0 ? -1 : 1;
    // beside it and a step behind (further from you), so she never blocks the throw
    this.stand.copy(this.to).addScaledVector(this.right, sgn * (HOOP_R + 0.34)).addScaledVector(this.n, -0.55).setY(0);
    this.host.constrain(this.stand);
  }

  /** The ring faces you (yaw only): n points from the ring towards the camera. */
  private faceBasis(at: THREE.Vector3): void {
    const cam = this.host.stage.cam;
    this.n.set(cam.x - at.x, 0, cam.z - at.z);
    if (this.n.lengthSq() < 1e-6) this.n.set(0, 0, 1);
    this.n.normalize();
    this.right.set(this.n.z, 0, -this.n.x);
  }

  // ------------------------------------------------------------------ throwing
  flick(power: number, side: number): boolean {
    if (this.state !== 'playing' || this.thrown >= BALLS) return false;
    const now = performance.now();
    if (now - this.last < 420) return false;
    this.last = now;
    const st = this.host.stage, u = this.host.unitsPerM;
    // from low in your view, as if from your hand
    this.o.copy(st.cam).addScaledVector(st.camDir, 0.5 * u);
    this.o.y = Math.max(0.15, this.o.y - 0.22 * u);
    const T = this.ring;
    this.d.subVectors(T, this.o).setY(0);
    const dist = Math.max(0.3, this.d.length());
    this.d.divideScalar(dist);
    // direction: at the ring, turned by the swipe's lean (a straight swipe goes straight at it; the camera may be
    // looking anywhere in 3D). The distance is the skill.
    const lean = THREE.MathUtils.clamp(side, -0.6, 0.6);
    this.v.copy(this.d).applyAxisAngle(UP, -(Math.abs(lean) < 0.07 ? 0 : lean - Math.sign(lean) * 0.07) * 0.7);
    // distance from the swipe's power: ~0.5 reaches the ring; within 9 % counts as spot on
    let D = dist * (0.5 + THREE.MathUtils.clamp(power, 0, 1.2) * 1.0);
    if (Math.abs(D / dist - 1) < 0.09) D = dist;
    // a lob that passes the ring's centre height after D
    const g = st.play.world.gravityY;
    const dy = T.y - this.o.y;
    let elev = 0.5;
    let den = D * Math.tan(elev) - dy;
    if (den < 0.15 * D) { elev = Math.atan((dy + 0.15 * D) / D) + 0.06; den = D * Math.tan(elev) - dy; }
    const c = Math.cos(elev);
    const speed = Math.min(18 * u, Math.sqrt((g * D * D) / (2 * c * c * Math.max(den, 1e-3))));
    this.v.multiplyScalar(c * speed).addScaledVector(UP, Math.sin(elev) * speed);
    const b = st.play.throwHeart(this.o, this.v);
    b.sense = false; // not catchable: this heart is for the ring
    this.faceBasis(T);
    this.shots.push({
      b, age: 0, side: this.t.subVectors(this.o, T).dot(this.n), prev: this.o.clone(), done: false, scored: false, touched: false,
      from: dist, money: this.thrown === BALLS - 1, rimT: 0,
    });
    this.thrown++;
    this.ui.setBalls(this.thrown);
    this.sounds.throw();
    return true;
  }

  // ------------------------------------------------------------------ per frame
  protected tick(dt: number): void {
    const st = this.host.stage;
    for (const s of this.shots) {
      if (s.done) continue;
      const b = s.b;
      s.age += dt;
      if (!b.alive) { this.resolve(s, false); continue; }
      if (b.landed && !s.touched) {
        s.touched = true;
        // touching the ring (not the floor) rings it
        if (b.p.y > b.r * 2 && Math.abs(this.t.subVectors(b.p, this.ring).dot(this.n)) < HOOP_BAND + b.r * 1.5) this.sounds.rim();
      }
      // crossing the ring's plane from your side: through the opening?
      this.faceBasis(this.ring);
      const sNow = this.t.subVectors(b.p, this.ring).dot(this.n);
      const sPrev = this.d.subVectors(s.prev, this.ring).dot(this.n);
      if (!s.scored && sPrev > 0 && sNow <= 0) {
        const k = sPrev / Math.max(1e-6, sPrev - sNow);
        const cx = s.prev.x + (b.p.x - s.prev.x) * k, cy = s.prev.y + (b.p.y - s.prev.y) * k, cz = s.prev.z + (b.p.z - s.prev.z) * k;
        const rr = Math.hypot(cx - this.ring.x, cy - this.ring.y, cz - this.ring.z);
        if (rr < HOOP_R - HOOP_BAND * 0.6 && this.ringK > 0.9 && this.moveT >= 1) this.score1(s, cx, cy, cz);
      }
      s.prev.copy(b.p);
      // a gold sparkle trail on the double heart
      if (s.money && !s.scored && (this.sparkT -= dt) <= 0) {
        this.sparkT = this.host.reduced ? 0.1 : 0.045;
        st.fx.emit({ count: 1, glyph: ['star', 'sparkle'], colors: [PAL.yellow, PAL.white], at: b.p, spread: [0.03, 0.03, 0.03], vel: [0, 0.1, 0], life: [0.35, 0.55], size: [0.05, 0.08], drag: 2 });
      }
      // on the floor (or too long in the air): done
      if (!s.scored && b.grounded) this.resolve(s, false);
      else if (s.age > 4.5) this.resolve(s, s.scored);
      else if (s.scored && (b.grounded || s.age > 3)) this.resolve(s, true);
    }
    if (this.thrown >= BALLS && this.resolved >= BALLS) this.finish();
  }

  private score1(s: Shot, x: number, y: number, z: number): void {
    const st = this.host.stage, a = st.actor, rm = this.host.reduced;
    s.scored = true;
    this.made++;
    this.streak++;
    const swish = !s.touched;
    if (swish) this.swishes++;
    let pts = swish ? 3 : 2;
    const extras: string[] = [];
    const longShot = s.from > this.dist.min + (this.dist.max - this.dist.min) * 0.62;
    if (longShot) { pts += 1; extras.push('long shot'); }
    if (this.streak >= 3) { pts += 1; extras.push(`${this.streak} in a row`); }
    if (s.money) { pts *= 2; extras.push('x2'); }
    this.score += pts;
    this.ui.streak(this.streak);
    this.sounds.score(swish, this.streak);
    const at = this.t.set(x, y, z);
    st.fx.emit({ count: rm ? 10 : 22, glyph: ['heart', 'star', 'sparkle'], colors: [...RAINBOW, PAL.pink], at, ring: HOOP_R * 0.9, vel: [0, 0.35, 0], velSpread: [0.25, 0.25, 0.25], drag: 2.2, life: [0.6, 1], size: [0.05, 0.1] });
    st.fx.emit({ count: 1, glyph: 'ring', colors: [swish ? PAL.yellow : PAL.white], at, life: [0.3, 0.34], size: [HOOP_R * 2.6, HOOP_R * 2.62], spin: 0 });
    this.popAt(this.t.set(x, y + HOOP_R + 0.1, z), `${swish ? 'Swish! ' : ''}+${pts}`, s.money ? 'star' : swish ? 'rainbow' : '', extras.join(' · '));
    a.face('happy', 2);
    a.jiggle(0.16);
    if (a.scripted === 0 && !a.walking) void a.once(this.streak >= 3 || swish ? 'cheer' : 'present', 2.2, 1.2);
    // the ring moves on (a beat later, so you see it go in)
    window.setTimeout(() => { if (this.state === 'playing' && this.made > 0 && this.thrown < BALLS) this.moveRing(); }, rm ? 350 : 650);
  }

  private resolve(s: Shot, scored: boolean): void {
    if (s.done) return;
    s.done = true;
    this.resolved++;
    if (!scored && !s.scored) {
      this.streak = 0;
      this.ui.streak(0);
      this.sounds.bump();
      const p = s.b.alive ? s.b.p : this.ring;
      this.popAt(this.t.copy(p).setY(Math.max(0.3, p.y + 0.25)), s.touched && p.y > 0.4 ? 'So close!' : 'Miss', 'miss');
      const a = this.host.stage.actor;
      if (a.scripted === 0) a.face('surprised', 0.7);
    }
  }

  private moveRing(): void {
    this.from.copy(this.ring);
    this.pickSpot(this.to);
    this.moveT = 0;
    this.standBeside();
    const st = this.host.stage;
    // her magic: a sparkle stream from her to the ring's new place
    st.fx.emit({ count: this.host.reduced ? 8 : 16, glyph: ['sparkle', 'star'], colors: [PAL.pink, PAL.yellow, PAL.white], at: this.ring, ring: HOOP_R, life: [0.5, 0.8], size: [0.05, 0.09], drag: 2, vel: [0, 0.3, 0] });
  }

  /** She walks to her spot beside the ring, then faces you. */
  walk(dt: number): void {
    const a = this.host.stage.actor;
    const dx = this.stand.x - a.position.x, dz = this.stand.z - a.position.z, d = Math.hypot(dx, dz);
    if (d > 0.08 && a.scripted === 0) {
      const k = Math.min(1, d * 1.6);
      this.v.set((dx / d) * k, 0, (dz / d) * k);
      a.drive(this.v, dt, (p) => this.host.constrain(p));
    } else {
      a.drive(this.zero, dt);
      if (!a.walking && a.scripted === 0 && !this.host.runner.busy) a.turnToPoint(this.host.stage.cam, dt, 4);
    }
  }

  protected visuals(dt: number): void {
    const kit = this.host.kit, h = kit.hoop;
    const live = this.state !== 'idle' && !(this.state === 'won' || this.state === 'over');
    this.ringK = Math.max(0, Math.min(1, this.ringK + dt * (live ? 2.5 : -2)));
    if (this.moveT < 1) {
      this.moveT = Math.min(1, this.moveT + dt / (this.host.reduced ? 0.45 : 0.8));
      const k = this.moveT < 0.5 ? 2 * this.moveT * this.moveT : 1 - Math.pow(-2 * this.moveT + 2, 2) / 2;
      this.ring.lerpVectors(this.from, this.to, k);
      this.ring.y += Math.sin(this.moveT * Math.PI) * 0.35; // a hop over
    } else this.ring.copy(this.to);
    const tt = performance.now() / 1000;
    const bob = this.host.reduced ? 0.015 : 0.04;
    h.visible = this.ringK > 0.01;
    this.faceBasis(this.ring);
    h.position.copy(this.ring);
    h.position.y += Math.sin(tt * 1.6) * bob * (this.moveT >= 1 ? 1 : 0);
    h.rotation.set(0, Math.atan2(this.n.x, this.n.z), 0);
    const pop = this.ringK < 1 ? this.ringK * (1.12 - 0.12 * this.ringK) : 1;
    h.scale.setScalar(Math.max(0.001, pop));
    // the rim colliders follow the ring (only while it is fully there)
    const on = h.visible && this.ringK > 0.9;
    for (let i = 0; i < RIM_N; i++) {
      const s = kit.rim[i], ang = (i / RIM_N) * Math.PI * 2;
      s.on = on;
      s.r = HOOP_BAND;
      s.c.copy(h.position).addScaledVector(this.right, Math.cos(ang) * HOOP_R).addScaledVector(UP, Math.sin(ang) * HOOP_R);
    }
  }

  protected summary(stars: number): { title: string; line: string } {
    const title = stars >= 3 ? 'Hoop hero!' : stars === 2 ? 'Great throwing!' : stars === 1 ? 'Nice throwing!' : 'Good try!';
    return { title, line: `${this.made} of ${BALLS} in · ${this.swishes} swish${this.swishes === 1 ? '' : 'es'}` };
  }

  protected clear(): void {
    this.shots.length = 0;
    const kit = this.host.kit;
    kit.hoop.visible = false;
    for (const r of kit.rim) r.on = false;
  }
}
