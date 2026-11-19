// AR: Cheer Bear and her house on your floor (world tracking, back camera).
//
//   placing  the stage follows a reticle on the floor; pinch to size it; Place is enabled once tracking has settled
//   placed   joystick walks her (camera-relative); Move (bottom left) goes back to placing and keeps everything;
//            tap her for a reaction; walk her to the door or tap the house and it grows around you (you're inside,
//            the TV plays the theme), "Leave house" or Move shrinks it back
//
// Leaving AR remembers where the stage stood relative to the phone; coming back (from 3D or Selfie) puts it back in
// the same place in front of you once tracking has settled again (a new run has a new world origin).
import * as THREE from 'three';
import type { ExperienceMode } from '../../../shared/contracts';
import type { Mode, XrScene } from '../../types';
import { HOUSE_H, type Stage } from '../../scene/stage';
import type { MomentRunner } from '../../scene/moments';
import { PAL } from '../../scene/fx';
import { angleTo, damp, ease } from '../../core/timeline';
import { ICON } from '../../hud/icons';
import { bindGestures, type Shared } from '../shared';

const SCALE = { def: 0.65, min: 0.25, max: 1.3 };
const REACH = { min: 0.8, max: 3.6 }; // metres from the phone the reticle may sit
const AREA = 3.0; // stage units she may walk from the stage centre
const TAP_REACTIONS = ['Wave', 'Cheer', 'Sparkle'];

type State = 'placing' | 'placed';

export class ArMode implements Mode {
  readonly id = 'ar' as const;
  readonly camera = 'world' as const;
  readonly root = new THREE.Group();
  private anchor = new THREE.Group();
  private reticle = new THREE.Group();
  private state: State = 'placing';
  private scale = SCALE.def;
  private everPlaced = false;
  private resumePlaced = false;
  private saved: { fwd: number; side: number; yaw: number } | null = null;
  private restoring = false;
  private active = false;
  private live = false; // enter() has run for this activation
  // house expansion
  inside = false;
  private houseK = 0;
  private houseFrom = { pos: new THREE.Vector3(), yaw: 0, scale: 1 };
  private houseTo = { pos: new THREE.Vector3(), yaw: 0, scale: 1 };
  private houseT = 1;
  private houseRest = new THREE.Vector3();
  private bearHop: { at: number; to: THREE.Vector3; yaw: number; done: boolean } | null = null;
  // HUD bits
  private placeBtn: HTMLButtonElement;
  private moveBtn: HTMLButtonElement;
  private leaveBtn: HTMLButtonElement;
  private stick: { readonly vector: THREE.Vector2; readonly active: boolean } | null = null;
  private unbind: (() => void) | null = null;
  private hintT = 0;
  private limitedT = 0;
  private lastHint = '';
  // scratch
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private camFwd = new THREE.Vector3();
  private ndc = new THREE.Vector2(0, -0.12);
  private inv = new THREE.Matrix4();

  constructor(private sh: Shared, readonly stage: Stage, private runner: MomentRunner) {
    this.root.name = 'ar-root';
    this.root.visible = false;
    this.anchor.name = 'ar-anchor';
    this.anchor.add(stage.root);
    stage.root.scale.setScalar(this.scale);
    this.anchor.visible = false;
    this.root.add(this.anchor, this.reticle);
    this.houseRest.copy(stage.house.position);
    this.buildReticle();

    const hud = sh.hud;
    this.placeBtn = hud.pill('Place Cheer Bear', () => this.place());
    this.placeBtn.classList.add('big');
    this.moveBtn = hud.toolButton({ label: 'Move', icon: ICON.move, aria: 'Move Cheer Bear somewhere else', onClick: () => this.move() });
    this.leaveBtn = hud.toolButton({ label: 'Leave', icon: ICON.leave, aria: 'Leave the house', onClick: () => this.leaveHouse() });
  }

  get placed(): boolean {
    return this.state === 'placed';
  }

  private buildReticle(): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.18, 48), mat);
    const pink = new THREE.MeshBasicMaterial({ color: PAL.pink, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.035, 24), pink);
    for (const m of [ring, dot]) { m.rotation.x = -Math.PI / 2; m.position.y = 0.003; m.renderOrder = 3; }
    this.reticle.add(ring, dot);
    this.reticle.visible = false;
    this.reticle.name = 'reticle';
  }

  // ------------------------------------------------------------------ Mode
  onScene(_xr: XrScene): void {
    // a new run has a new world origin: enter() puts the stage back relative to the phone once tracking settles
  }

  enter(_from: ExperienceMode | null): void {
    const bear = this.sh.bear();
    if (bear && !this.stage.actor.attached) this.stage.actor.attach(bear);
    this.active = true;
    this.live = true;
    this.root.visible = true;
    this.unbind = bindGestures(this.sh.ctx.engine.canvas, {
      onPinch: (k) => {
        if (this.state !== 'placing') return;
        this.scale = THREE.MathUtils.clamp(this.scale * k, SCALE.min, SCALE.max);
        this.stage.root.scale.setScalar(this.scale);
      },
    });
    this.limitedT = 0;
    if (this.resumePlaced) {
      this.restoring = true;
      this.state = 'placed';
    } else this.state = 'placing';
    this.anchor.visible = false;
    this.syncHud();
  }

  exit(_to: ExperienceMode): void {
    this.active = false;
    this.live = false;
    this.runner.cancel();
    if (this.inside) this.collapseNow();
    this.remember();
    this.resumePlaced = this.state === 'placed' && !!this.saved;
    this.unbind?.();
    this.unbind = null;
    this.root.visible = false;
    this.placeBtn.remove();
    this.moveBtn.remove();
    this.leaveBtn.remove();
    this.sh.hud.joystick(false);
    this.sh.hud.hint('');
    this.stick = null;
  }

  trigger(name: string): boolean {
    return this.runner.trigger(name);
  }

  onTap(_x: number, _y: number, ndc: THREE.Vector2): boolean {
    if (!this.active) return false;
    if (this.state === 'placing') {
      if (this.canPlace()) this.place();
      return true;
    }
    if (this.restoring) return false;
    const ray = this.sh.ctx.engine.ray(ndc).ray.clone();
    this.stage.root.updateMatrixWorld();
    ray.applyMatrix4(this.inv.copy(this.stage.root.matrixWorld).invert());
    const a = this.stage.actor;
    const box = new THREE.Box3(new THREE.Vector3(-0.32, 0, -0.32).add(a.position), new THREE.Vector3(0.32, 1.02, 0.32).add(a.position));
    if (ray.intersectsBox(box)) {
      const name = a.asleep ? 'WakeUp' : TAP_REACTIONS[Math.floor(Math.random() * TAP_REACTIONS.length)];
      if ((!this.runner.busy || a.asleep) && this.runner.trigger(name)) this.sh.tapAction(name);
      return true;
    }
    if (!this.inside && this.houseHit(ndc)) {
      this.enterHouse();
      return true;
    }
    return false;
  }

  reset(): void {
    this.runner.reset();
    if (this.inside) this.collapseNow();
    const a = this.stage.actor;
    a.position.set(0, 0, 0);
    a.setHeading(0);
    this.scale = SCALE.def;
    this.stage.root.scale.setScalar(this.scale);
    this.everPlaced = false;
    this.resumePlaced = false;
    this.saved = null;
    this.restoring = false;
    this.state = 'placing';
    this.anchor.visible = false;
    if (this.live) this.syncHud();
  }

  // ------------------------------------------------------------------ placing
  private canPlace(): boolean {
    return this.state === 'placing' && this.sh.ctx.engine.settled() && this.reticle.visible;
  }

  private place(): void {
    if (!this.canPlace()) return;
    this.state = 'placed';
    this.reticle.visible = false;
    const first = !this.everPlaced;
    this.everPlaced = true;
    this.stage.fx.emit({ count: 30, glyph: ['sparkle', 'star'], colors: [PAL.pink, PAL.yellow, PAL.white, PAL.blue], at: this.stage.actor.position.clone().setY(0.1), ring: 0.5, vel: [0, 0.6, 0], velSpread: [0.2, 0.2, 0.2], life: [0.8, 1.3], size: [0.06, 0.12] });
    if (first) this.runner.trigger('Wave');
    this.syncHud();
    this.flashHint('Walk her to her house', 5);
  }

  private move(): void {
    if (this.state !== 'placed' || this.restoring) return;
    this.runner.cancel();
    if (this.inside) this.collapseNow();
    this.state = 'placing';
    this.syncHud();
  }

  /** Remember the stage relative to the phone (called when leaving AR). */
  private remember(): void {
    const xr = this.sh.ctx.engine.xr;
    if (!xr || this.state !== 'placed' || this.restoring) return;
    this.camBasis(xr.camera);
    this.v.copy(this.anchor.position).sub(this.camPos).setY(0);
    const right = this.w.set(-this.camFwd.z, 0, this.camFwd.x);
    this.saved = { fwd: this.v.dot(this.camFwd), side: this.v.dot(right), yaw: angleTo(Math.atan2(this.camFwd.x, this.camFwd.z), this.anchor.rotation.y) };
  }

  private restore(cam: THREE.Camera): void {
    this.camBasis(cam);
    const s = this.saved ?? { fwd: 1.8, side: 0, yaw: Math.PI };
    const right = this.w.set(-this.camFwd.z, 0, this.camFwd.x);
    this.anchor.position.copy(this.camPos).addScaledVector(this.camFwd, s.fwd).addScaledVector(right, s.side).setY(0);
    this.anchor.rotation.set(0, Math.atan2(this.camFwd.x, this.camFwd.z) + s.yaw, 0);
    this.restoring = false;
    this.anchor.visible = true;
    this.stage.fx.emit({ count: 24, glyph: ['sparkle', 'star'], colors: [PAL.pink, PAL.yellow, PAL.white], at: this.stage.actor.position.clone().setY(0.4), burst: 0.8, drag: 1.5, life: [0.8, 1.2], size: [0.06, 0.11] });
    this.syncHud();
  }

  private camBasis(cam: THREE.Camera): void {
    cam.getWorldPosition(this.camPos);
    cam.getWorldDirection(this.camFwd).setY(0);
    if (this.camFwd.lengthSq() < 1e-6) this.camFwd.set(0, 0, -1);
    this.camFwd.normalize();
  }

  // ------------------------------------------------------------------ house
  private houseHit(ndc: THREE.Vector2): boolean {
    const r = this.sh.ctx.engine.ray(ndc);
    return r.intersectObject(this.stage.houseModel, true).length > 0;
  }

  /** The house grows around you: you're inside, facing the TV. */
  enterHouse(): void {
    const xr = this.sh.ctx.engine.xr;
    if (this.inside || this.state !== 'placed' || this.restoring || !xr) return;
    this.runner.cancel();
    const st = this.stage, h = st.house;
    st.root.updateMatrixWorld();
    // camera in stage space
    st.update(0, xr.camera);
    const c = st.cam.clone().setY(0);
    const look = st.camDir.clone().setY(0);
    if (look.lengthSq() < 1e-6) look.set(0, 0, -1);
    look.normalize();
    const E = Math.max(1.2, 2.9 / (HOUSE_H * this.scale));
    const D = st.houseSize.z * E;
    this.houseFrom = { pos: h.position.clone(), yaw: h.rotation.y, scale: h.scale.x };
    this.houseTo = { pos: c.clone().addScaledVector(look, D * 0.12), yaw: Math.atan2(-look.x, -look.z), scale: E };
    this.houseT = 0;
    this.inside = true;
    st.interior.visible = true;
    if (st.portal) st.portal.visible = false;
    st.mailbox.visible = false;
    st.car.visible = false;
    // she pops over to stand in front of you, inside
    const to = c.clone().addScaledVector(look, 1.1 / this.scale);
    this.bearHop = { at: 0.55, to, yaw: Math.atan2(-look.x, -look.z), done: false };
    st.actor.scripted++;
    this.sh.media.playTheme('inside', true);
    this.syncHud();
    this.flashHint("You're in her house!", 4);
  }

  leaveHouse(): void {
    if (!this.inside || this.houseT < 1) return;
    const st = this.stage, h = st.house;
    this.houseFrom = { pos: h.position.clone(), yaw: h.rotation.y, scale: h.scale.x };
    this.houseTo = { pos: this.houseRest.clone(), yaw: 0, scale: 1 };
    this.houseT = 0;
    this.inside = false;
    const door = st.door.clone().add(new THREE.Vector3(0, 0, 0.35));
    this.bearHop = { at: 0.45, to: door, yaw: 0, done: false };
    st.actor.scripted++;
    this.sh.media.stopTheme('inside');
    this.syncHud();
  }

  /** Instantly back to the small house (Move, leaving AR, Start again). */
  private collapseNow(): void {
    const st = this.stage, h = st.house;
    h.position.copy(this.houseRest);
    h.rotation.set(0, 0, 0);
    h.scale.setScalar(1);
    st.interior.visible = false;
    if (st.portal) st.portal.visible = true;
    st.mailbox.visible = true;
    if (this.bearHop && !this.bearHop.done) st.actor.scripted = Math.max(0, st.actor.scripted - 1);
    this.bearHop = null;
    if (this.inside) st.actor.position.copy(st.door).add(new THREE.Vector3(0, 0, 0.35));
    this.inside = false;
    this.houseT = 1;
    this.sh.media.stopTheme('inside');
    if (this.live) this.syncHud();
  }

  private animateHouse(dt: number): void {
    if (this.houseT >= 1) return;
    const st = this.stage, h = st.house;
    this.houseT = Math.min(1, this.houseT + dt / (this.sh.reduced ? 0.5 : 1.3));
    const k = ease.inOut(this.houseT);
    h.position.lerpVectors(this.houseFrom.pos, this.houseTo.pos, k);
    h.rotation.y = this.houseFrom.yaw + angleTo(this.houseFrom.yaw, this.houseTo.yaw) * k;
    h.scale.setScalar(this.houseFrom.scale + (this.houseTo.scale - this.houseFrom.scale) * k);
    const hop = this.bearHop;
    if (hop && !hop.done && this.houseT >= hop.at) {
      hop.done = true;
      const a = st.actor;
      st.fx.emit({ count: 18, glyph: ['sparkle', 'star'], colors: [PAL.pink, PAL.yellow, PAL.white], at: a.position.clone().setY(0.5), burst: 0.7, drag: 1.5, life: [0.6, 1], size: [0.06, 0.1] });
      a.position.copy(hop.to);
      a.setHeading(hop.yaw);
      st.fx.emit({ count: 22, glyph: ['sparkle', 'star', 'heart'], colors: [PAL.pink, PAL.yellow, PAL.white], at: hop.to.clone().setY(0.5), burst: 0.8, drag: 1.5, life: [0.7, 1.1], size: [0.06, 0.11] });
      a.scripted = Math.max(0, a.scripted - 1);
      a.settle();
      a.face('happy', 2);
    }
    if (this.houseT >= 1) {
      this.bearHop = null;
      if (!this.inside) {
        st.interior.visible = false;
        if (st.portal) st.portal.visible = true;
        st.mailbox.visible = true;
      }
    }
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number): void {
    const xr = this.sh.ctx.engine.xr;
    if (!this.active || !xr) return;
    const eng = this.sh.ctx.engine, st = this.stage, a = st.actor;
    const settled = eng.settled();

    if (this.restoring && settled) this.restore(xr.camera);

    if (this.state === 'placing') {
      const hasHit = settled && this.floorHit();
      this.reticle.visible = hasHit;
      if (hasHit) {
        const first = !this.anchor.visible;
        this.reticle.position.copy(this.hit);
        this.reticle.scale.setScalar(1 + Math.sin(performance.now() / 260) * 0.05);
        // the stage previews on the reticle, facing you
        this.camBasis(xr.camera);
        const yaw = Math.atan2(this.camPos.x - this.hit.x, this.camPos.z - this.hit.z);
        if (first) {
          this.anchor.position.copy(this.hit);
          this.anchor.rotation.y = yaw;
        } else {
          this.anchor.position.lerp(this.hit, damp(12, dt));
          this.anchor.rotation.y += angleTo(this.anchor.rotation.y, yaw) * damp(8, dt);
        }
        this.anchor.visible = true;
      }
      this.placeBtn.disabled = !hasHit;
      this.placeBtn.textContent = hasHit ? 'Place Cheer Bear' : 'Getting ready…';
    }

    // walking
    if (this.state === 'placed' && !this.restoring && this.stick) {
      const sv = this.stick.vector;
      this.camBasis(xr.camera);
      const right = this.w.set(-this.camFwd.z, 0, this.camFwd.x);
      this.v.copy(right).multiplyScalar(sv.x).addScaledVector(this.camFwd, -sv.y);
      this.v.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -this.anchor.rotation.y); // world -> stage-local
      if (this.v.lengthSq() > 0.01 && a.asleep) this.runner.nudge();
      if (this.houseT >= 1) a.drive(this.v, dt, (p) => this.constrain(p));
    } else a.drive(this.v.set(0, 0, 0), dt);

    this.runner.update(dt);
    this.animateHouse(dt);
    st.root.updateMatrixWorld();
    st.update(dt, xr.camera);
    a.update(dt, xr.camera.getWorldPosition(this.w));
    this.hints(dt, eng.tracking, settled);
  }

  /** Keep her in the play area and out of the house walls; the doorway takes her inside. */
  private constrain(p: THREE.Vector3): void {
    const st = this.stage, h = st.house;
    if (this.inside) {
      // inside: stay within the (grown) room, in house-local space
      const local = h.worldToLocal(st.root.localToWorld(p.clone()));
      const hw = st.houseSize.x / 2 - 0.12, hd = st.houseSize.z / 2 - 0.12;
      local.x = THREE.MathUtils.clamp(local.x, -hw, hw);
      local.z = THREE.MathUtils.clamp(local.z, -hd, hd);
      local.y = 0;
      p.copy(st.root.worldToLocal(h.localToWorld(local))).setY(0);
      return;
    }
    const l = Math.hypot(p.x, p.z);
    if (l > AREA) { p.x *= AREA / l; p.z *= AREA / l; }
    const hx = st.houseSize.x / 2 + 0.22, hz = st.houseSize.z / 2 + 0.22;
    const dx = p.x - h.position.x, dz = p.z - h.position.z;
    if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
      // walked into the house: through the door = go inside; anywhere else = slide along the wall
      if (dz > 0 && Math.abs(dx) < 0.45 && this.state === 'placed') {
        p.z = h.position.z + hz;
        this.enterHouse();
        return;
      }
      const px = hx - Math.abs(dx), pz = hz - Math.abs(dz);
      if (px < pz) p.x = h.position.x + Math.sign(dx || 1) * hx;
      else p.z = h.position.z + Math.sign(dz || 1) * hz;
    }
  }

  private floorHit(): boolean {
    const r = this.sh.ctx.engine.ray(this.ndc);
    const xr = this.sh.ctx.engine.xr!;
    this.camBasis(xr.camera);
    const got = r.ray.intersectPlane(this.plane, this.hit);
    // looking up (no hit) or too far: keep it at a comfortable distance straight ahead
    let d: number;
    if (got) {
      this.v.copy(this.hit).sub(this.camPos).setY(0);
      d = this.v.length();
    } else d = REACH.max;
    d = THREE.MathUtils.clamp(d, REACH.min, REACH.max);
    this.hit.copy(this.camPos).addScaledVector(this.camFwd, d).setY(0);
    if (got) {
      // keep the sideways offset of the real hit
      const side = this.w.set(-this.camFwd.z, 0, this.camFwd.x);
      const off = this.v.dot(side);
      this.hit.addScaledVector(side, THREE.MathUtils.clamp(off, -1, 1));
    }
    return true;
  }

  // ------------------------------------------------------------------ HUD
  private syncHud(): void {
    if (!this.live) return;
    const hud = this.sh.hud;
    const placing = this.state === 'placing';
    const walking = !placing && !this.restoring;
    if (placing) hud.centre.appendChild(this.placeBtn);
    else this.placeBtn.remove();
    this.stick = walking ? hud.joystick(true) : null;
    if (!walking) hud.joystick(false);
    // Move: bottom left, always there once placed; Leave stacks above it while you're inside
    // (the left slot stacks bottom-up: first child sits at the bottom)
    if (walking) hud.left.appendChild(this.moveBtn);
    else this.moveBtn.remove();
    if (walking && this.inside) hud.left.appendChild(this.leaveBtn);
    else this.leaveBtn.remove();
  }

  private flashHint(text: string, s: number): void {
    this.lastHint = text;
    this.hintT = s;
    this.sh.hud.hint(text);
  }

  private hints(dt: number, tracking: string, settled: boolean): void {
    let text = '';
    this.limitedT = tracking === 'LIMITED' ? this.limitedT + dt : 0;
    if (this.limitedT > 1.5) text = 'Move your phone slowly';
    else if (this.restoring || (this.state === 'placing' && !settled)) text = 'Point at the floor';
    else if (this.state === 'placing') text = 'Pinch to size, then Place';
    else if (this.hintT > 0) {
      this.hintT -= dt;
      text = this.hintT > 0 ? this.lastHint : '';
    }
    this.sh.hud.hint(text);
  }

  dispose(): void {
    this.unbind?.();
    this.placeBtn.remove();
    this.moveBtn.remove();
    this.leaveBtn.remove();
  }
}
