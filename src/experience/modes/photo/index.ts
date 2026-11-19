// 3D Photo (back camera, world tracking). Port of the Mattercraft "3D-Photo" scene: Cheer Bear with her picture frame
// on the floor, so a friend can stand next to her (or line their face up in the frame) for a photo.
//
//   placing  a reticle on the floor with Cheer Bear previewing on it, facing you; pinch to size; Place (or a tap) once
//            world tracking has settled
//   placed   shutter bottom centre; Move bottom left (always there, keeps pose and size); a small pose picker above
//            the shutter: Frame (the original baked model, CB-Frame.glb: she holds the frame), Wave, Cheer (the shared
//            rigged bear, with the stages' two lights so her shaders are the ones already compiled)
//   capture  camera + 3D (engine screenshot) + a small title cloud -> the same review sheet as the Selfie
import * as THREE from 'three';
import type { BearClip, ExperienceMode } from '../../../shared/contracts';
import type { Mode, ModeContext, XrScene } from '../../types';
import { ReviewSheet, RevealPlayer, compose, engineShot, flash, el, segmented } from '../../capture';
import { drawFrameArt, loadFrameArt } from '../../capture/frame-art';
import { bindGestures } from '../shared';
import { ICON } from '../../hud/icons';

const FRAME_URL = '/models/capture/cb-frame.glb'; // 3.9 MB source -> 221 KB (meshopt + 1024 webp)
const SIZE = { def: 1.0, min: 0.4, max: 1.8 }; // her height in metres
const REACH = { min: 0.9, max: 4.0 };
const POSES = [
  { id: 'frame', label: 'Frame' },
  { id: 'wave', label: 'Wave' },
  { id: 'cheer', label: 'Cheer' },
] as const;
type Pose = (typeof POSES)[number]['id'];
type State = 'off' | 'placing' | 'placed' | 'busy' | 'review';

const REACT: Record<string, BearClip> = {
  wave: 'wave', dance: 'dance', party: 'dance', cold: 'shiver',
  cheer: 'cheer', sparkle: 'cheer', magic: 'cheer', rainbow: 'cheer', house: 'cheer', running: 'cheer', wakeup: 'cheer',
};

export class PhotoMode implements Mode {
  readonly id = 'photo' as ExperienceMode;
  readonly camera = 'world' as const;
  readonly root = new THREE.Group();
  state: State = 'off';
  pose: Pose = 'frame';
  size = SIZE.def;
  readonly diag = { shots: 0, lastPhoto: null as Blob | null, placedCount: 0, moved: 0 };

  private anchor = new THREE.Group();
  private model = new THREE.Group(); // scaled to `size`
  private framed = new THREE.Group(); // the baked bear + frame
  private bearHolder = new THREE.Group();
  private reticle = new THREE.Group();
  private placeBtn: HTMLButtonElement;
  private moveBtn: HTMLButtonElement;
  private shutterBtn: HTMLButtonElement | null = null;
  private picker: { el: HTMLElement; set(id: string): void };
  private review: ReviewSheet;
  private reveal: RevealPlayer;
  private unbind: (() => void) | null = null;
  private hintT = 0;
  private lastReact = 0;
  // scratch
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private camFwd = new THREE.Vector3();
  private ndc = new THREE.Vector2(0, -0.12);

  constructor(private ctx: ModeContext) {
    this.root.name = 'photo-root';
    this.root.visible = false;
    const hemi = new THREE.HemisphereLight(0xffffff, 0xc8a8bc, 1.25);
    const sun = new THREE.DirectionalLight(0xfff3e6, 1.7);
    sun.position.set(1.5, 3, 2);
    this.root.add(hemi, sun, this.anchor, this.reticle);
    this.anchor.add(this.model);
    this.model.add(this.framed, this.bearHolder);
    this.anchor.visible = false;
    this.bearHolder.name = 'photo-bear';
    this.buildReticle();

    this.placeBtn = el('button', 'cbx-pill', 'Getting ready…');
    this.placeBtn.type = 'button';
    this.placeBtn.disabled = true;
    this.placeBtn.addEventListener('click', (e) => { e.stopPropagation(); this.place(); });
    this.moveBtn = ctx.hud.toolButton({ label: 'Move', icon: ICON.move, aria: 'Move Cheer Bear somewhere else', onClick: () => this.move() });
    this.picker = segmented('Cheer Bear pose', POSES.map((p) => ({ id: p.id, label: p.label })), this.pose, (id) => this.setPose(id as Pose));

    const name = 'cheer-bear-3d-photo';
    this.review = new ReviewSheet({
      container: ctx.container,
      name,
      title: 'Your 3D photo',
      share: { title: 'Cheer Bear and me', text: 'A photo with Cheer Bear!' },
      onRetake: () => this.toPlaced(),
      onReveal: (b) => this.reveal.play(b),
    });
    this.reveal = new RevealPlayer(ctx.container, name);
  }

  private buildReticle(): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.17, 0.2, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }),
    );
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.04, 24),
      new THREE.MeshBasicMaterial({ color: 0xff389b, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }),
    );
    for (const m of [ring, dot]) { m.rotation.x = -Math.PI / 2; m.position.y = 0.003; m.renderOrder = 3; }
    this.reticle.add(ring, dot);
    this.reticle.visible = false;
    this.reticle.name = 'photo-reticle';
  }

  // ------------------------------------------------------------------ Mode
  async load(): Promise<void> {
    const [g] = await Promise.all([this.ctx.assets.gltf(FRAME_URL), loadFrameArt()]);
    const scene = g.scene.clone(true);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; }
    });
    // the model is 1 unit tall (her head), feet on y = 0, facing +z
    this.framed.add(scene);
    this.framed.name = 'cb-frame';
    this.applyPose();
  }

  onScene(_xr: XrScene): void {
    /* a new run has a new world origin: we place again (pose and size kept) */
  }

  enter(_from: ExperienceMode | null): void {
    this.root.visible = true;
    this.borrowBear();
    this.applyPose();
    this.model.scale.setScalar(this.size);
    this.unbind = bindGestures(this.ctx.engine.canvas, {
      onPinch: (k) => {
        if (this.state !== 'placing' && this.state !== 'placed') return;
        this.size = THREE.MathUtils.clamp(this.size * k, SIZE.min, SIZE.max);
        this.model.scale.setScalar(this.size);
      },
    });
    this.toPlacing();
  }

  exit(_to: ExperienceMode): void {
    this.state = 'off';
    this.review.close();
    this.reveal.close();
    this.unbind?.();
    this.unbind = null;
    this.placeBtn.remove();
    this.moveBtn.remove();
    this.shutterBtn?.remove();
    this.shutterBtn = null;
    this.picker.el.remove();
    this.returnBear();
    this.root.visible = false;
    this.anchor.visible = false;
    this.reticle.visible = false;
    this.ctx.hud.hint('');
  }

  update(dt: number): void {
    const xr = this.ctx.engine.xr;
    if (!xr || this.state === 'off') return;
    const settled = this.ctx.engine.settled();
    if (this.state === 'placing') {
      const ok = settled && this.floorHit(xr.camera);
      this.reticle.visible = ok;
      if (ok) {
        this.reticle.position.copy(this.hit);
        this.reticle.scale.setScalar(1 + Math.sin(performance.now() / 260) * (this.ctx.reducedMotion ? 0.01 : 0.05));
        const yaw = Math.atan2(this.camPos.x - this.hit.x, this.camPos.z - this.hit.z);
        if (!this.anchor.visible) {
          this.anchor.position.copy(this.hit);
          this.anchor.rotation.set(0, yaw, 0);
        } else {
          this.anchor.position.lerp(this.hit, 1 - Math.exp(-12 * dt));
          let dy = yaw - this.anchor.rotation.y;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          this.anchor.rotation.y += dy * (1 - Math.exp(-8 * dt));
        }
        this.anchor.visible = true;
      }
      this.placeBtn.disabled = !ok;
      this.placeBtn.textContent = ok ? 'Place Cheer Bear' : 'Getting ready…';
      this.ctx.hud.hint(settled ? 'Pinch to size, then Place' : 'Point at the floor');
    } else if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) this.ctx.hud.hint('');
    }
    const bear = this.ctx.bear;
    if (bear && bear.object.parent === this.bearHolder) {
      bear.lookAt(xr.camera.getWorldPosition(this.w));
      bear.update(dt);
    }
  }

  onTap(): boolean {
    if (this.state === 'placing') {
      if (!this.placeBtn.disabled) this.place();
      return true;
    }
    return false;
  }

  trigger(name: string): boolean {
    const bear = this.ctx.bear;
    if (!bear || this.pose === 'frame' || this.state !== 'placed') return false;
    const clip = REACT[name.toLowerCase().replace(/\s+/g, '')];
    if (!clip) return false;
    const t = performance.now();
    if (t - this.lastReact < 1200) return false;
    this.lastReact = t;
    bear.play(clip, { once: true, fade: 0.25 });
    return true;
  }

  reset(): void {
    this.pose = 'frame';
    this.picker.set('frame');
    this.size = SIZE.def;
    this.model.scale.setScalar(this.size);
    this.applyPose();
    if (this.state !== 'off') { this.review.close(); this.reveal.close(); this.toPlacing(); }
  }

  dispose(): void {
    this.exit('showcase');
  }

  // ------------------------------------------------------------------ flow
  private toPlacing(): void {
    this.state = 'placing';
    this.anchor.visible = false;
    this.reticle.visible = false;
    const hud = this.ctx.hud;
    this.shutterBtn?.remove();
    this.moveBtn.remove();
    this.picker.el.remove();
    this.placeBtn.disabled = true; // the frame loop enables it once the reticle is on the floor
    this.placeBtn.textContent = 'Getting ready…';
    hud.centre.appendChild(this.placeBtn);
    hud.hint('Point at the floor');
  }

  private place(): void {
    if (this.state !== 'placing' || this.placeBtn.disabled || !this.reticle.visible) return;
    this.diag.placedCount++;
    this.reticle.visible = false;
    this.anchor.position.copy(this.hit);
    this.toPlaced();
    this.ctx.hud.hint('Pick a pose, then shoot');
    this.hintT = 4;
    const bear = this.ctx.bear;
    if (bear && this.pose !== 'frame') bear.play('wave', { once: true, fade: 0.25 });
  }

  private toPlaced(): void {
    if (this.state === 'off') return;
    this.state = 'placed';
    const hud = this.ctx.hud;
    this.placeBtn.remove();
    if (!this.shutterBtn) this.shutterBtn = hud.shutter(() => void this.shoot(), 'Take a 3D photo');
    this.shutterBtn.disabled = false;
    hud.centre.appendChild(this.shutterBtn);
    hud.left.appendChild(this.moveBtn); // bottom left, always there once placed
    hud.above.appendChild(this.picker.el);
    this.anchor.visible = true;
  }

  private move(): void {
    if (this.state !== 'placed') return;
    this.diag.moved++;
    this.toPlacing();
    this.anchor.visible = true; // keep showing her while you look for a new spot
  }

  private setPose(p: Pose): void {
    this.pose = p;
    this.applyPose();
    const bear = this.ctx.bear;
    if (bear && p !== 'frame' && bear.object.parent === this.bearHolder) bear.play(p === 'wave' ? 'wave' : 'cheer', { fade: 0.3 });
  }

  private applyPose(): void {
    this.framed.visible = this.pose === 'frame';
    this.bearHolder.visible = this.pose !== 'frame';
  }

  private async shoot(): Promise<void> {
    if (this.state !== 'placed') return;
    this.state = 'busy';
    if (this.shutterBtn) this.shutterBtn.disabled = true;
    try {
      flash(this.ctx.container, this.ctx.reducedMotion);
      const img = await engineShot(this.ctx.engine);
      if (this.state !== 'busy') return;
      const { blob } = await compose(img, (g, w, h) => drawFrameArt(g, w, h, { title: true, titleWidth: 0.4, titleTop: 0.025 }));
      img.src = '';
      if (this.state !== 'busy') return;
      this.diag.shots++;
      this.diag.lastPhoto = blob;
      this.ctx.capture(blob);
      this.state = 'review';
      this.review.show(blob);
    } catch (e) {
      console.warn('[3d photo] failed', e);
      this.ctx.hud.toast('That photo did not work. Try again?', 2200);
      this.toPlaced();
    }
  }

  // ------------------------------------------------------------------ helpers
  private borrowBear(): void {
    const bear = this.ctx.bear;
    if (!bear) return;
    const o = bear.object;
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    o.scale.setScalar(1 / (bear.height || 1));
    o.userData.cbxOwnGpu = !!bear.releaseRenderer;
    this.bearHolder.add(o);
    bear.play(this.pose === 'cheer' ? 'cheer' : this.pose === 'wave' ? 'wave' : 'idle', { fade: 0.2 });
  }

  private returnBear(): void {
    const bear = this.ctx.bear;
    if (bear && bear.object.parent === this.bearHolder) this.bearHolder.remove(bear.object);
  }

  private floorHit(cam: THREE.Camera): boolean {
    const r = this.ctx.engine.ray(this.ndc);
    cam.getWorldPosition(this.camPos);
    cam.getWorldDirection(this.camFwd).setY(0);
    if (this.camFwd.lengthSq() < 1e-6) this.camFwd.set(0, 0, -1);
    this.camFwd.normalize();
    const got = r.ray.intersectPlane(this.plane, this.hit);
    let d = REACH.max;
    if (got) d = this.v.copy(this.hit).sub(this.camPos).setY(0).length();
    d = THREE.MathUtils.clamp(d, REACH.min, REACH.max);
    const side = this.w.set(-this.camFwd.z, 0, this.camFwd.x);
    const off = got ? THREE.MathUtils.clamp(this.v.dot(side), -1, 1) : 0;
    this.hit.copy(this.camPos).addScaledVector(this.camFwd, d).addScaledVector(side, off).setY(0);
    return true;
  }
}

export function createMode(ctx: ModeContext): Mode {
  return new PhotoMode(ctx);
}
export default createMode;
