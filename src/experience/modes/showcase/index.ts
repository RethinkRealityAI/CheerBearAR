// Showcase: Cheer Bear in Care-a-Lot, no camera. Its own WebGL canvas and renderer (works on computers); the engine
// is stopped while it runs, and this renderer is disposed (context released) whenever a camera mode runs.
//
// Also renders the splash: the bear stands inside the splash's transparent "hero window" (setViewOffset framing),
// then the camera eases out to the play framing when Start slides the splash away.
//
// Controls: joystick (or arrow keys / WASD) walks her, the camera follows; drag to look around a little; pinch or
// scroll to zoom within limits; tap her for a reaction.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ExperienceMode } from '../../../shared/contracts';
import type { Mode } from '../../types';
import type { Stage } from '../../scene/stage';
import type { MomentRunner } from '../../scene/moments';
import { damp, ease } from '../../core/timeline';
import { IS_PHONE } from '../../core/device';
import { bindGestures, keyStick, type Shared } from '../shared';

const FOV_WIDE = 50; // portrait screens: a taller view shows more of Care-a-Lot
const FOV_LAND = 38;
const PLAY = { dist: 3.5, pitch: 0.14, targetY: 0.78 }; // looking a little above her: she stands in the lower half, clear of the top bar
const LIM = { yaw: 1.0, pitchMin: 0.02, pitchMax: 0.6, distMin: 1.9, distMax: 6, area: 3.4 };

export class ShowcaseMode implements Mode {
  readonly id = 'showcase' as const;
  readonly camera = 'none' as const;
  readonly scene = new THREE.Scene();
  readonly cam = new THREE.PerspectiveCamera(FOV_LAND, 1, 0.05, 200);
  renderer: THREE.WebGLRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private env: THREE.WebGLRenderTarget | null = null;
  private ro: ResizeObserver | null = null;
  private unbind: (() => void) | null = null;
  private keys = keyStick();
  private active = false;
  private ready: Promise<void> | null = null;
  private last = 0;
  // camera rig
  private yaw = 0;
  private pitch = PLAY.pitch;
  private dist = PLAY.dist;
  private target = new THREE.Vector3(0, PLAY.targetY, 0);
  /** 1 = splash framing (bear inside the hero window), 0 = play framing. */
  private framing = 1;
  private framingTo = 1;
  private hero: { x: number; y: number; w: number; h: number } | null = null;
  private dir = new THREE.Vector3();
  private v = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private slow = 0; // adaptive resolution
  private frames = 0;
  private dpr = 1;
  private hintT = 0;
  /** Smoothed frames per second (tests, diagnostics). */
  fps = 60;
  private wide = 0; // extra camera distance while a big moment plays
  private stick: { readonly vector: THREE.Vector2; readonly active: boolean } | null = null;
  /** Programs compiled after warm-up (pitfall 13 check: must not grow when moments appear). */
  programsAfterWarm = 0;

  constructor(private sh: Shared, readonly stage: Stage, private runner: MomentRunner, backdrop: THREE.Texture) {
    backdrop.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.background = backdrop;
    // the panorama's floating island (its centre column) straight ahead of the default view
    this.scene.backgroundRotation.set(0, Math.PI / 2, 0);
    this.scene.add(stage.root);
    this.scene.add(cloudFloor());
  }

  // ------------------------------------------------------------------ renderer life cycle
  /** Create the canvas + renderer (if needed), compile everything, start drawing. Resolves when the first frame is ready. */
  ensureRenderer(): Promise<void> {
    if (this.ready) return this.ready;
    const c = document.createElement('canvas');
    c.className = 'cbx-3d';
    c.setAttribute('aria-label', 'Cheer Bear in Care-a-Lot');
    c.style.visibility = 'hidden';
    this.sh.container.insertBefore(c, this.sh.container.firstChild);
    this.canvas = c;
    const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: false, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    this.dpr = Math.min(window.devicePixelRatio || 1, IS_PHONE ? 2 : 1.75);
    r.setPixelRatio(this.dpr);
    this.renderer = r;
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.sh.container);
    // same light environment as the camera modes (the bear looks the same everywhere)
    const pm = new THREE.PMREMGenerator(r);
    this.env = pm.fromScene(new RoomEnvironment(), 0.04);
    pm.dispose();
    this.scene.environment = this.env.texture;
    this.scene.environmentIntensity = 0.7;
    this.unbind = bindGestures(c, {
      onTap: (x, y) => this.tap(x, y),
      onDrag: (dx, dy) => {
        if (!this.active) return;
        this.yaw = THREE.MathUtils.clamp(this.yaw - dx * 0.006, -LIM.yaw, LIM.yaw);
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, LIM.pitchMin, LIM.pitchMax);
      },
      onPinch: (k) => { if (this.active) this.dist = THREE.MathUtils.clamp(this.dist / k, LIM.distMin, LIM.distMax); },
      onWheel: (d) => { if (this.active) this.dist = THREE.MathUtils.clamp(this.dist * Math.exp(d * 0.0012), LIM.distMin, LIM.distMax); },
    });
    this.placeCamera(0);
    // compile every shader in the scene (hidden moment props too) before the first visible frame
    this.ready = r.compileAsync(this.scene, this.cam).catch(() => undefined).then(() => {
      if (this.renderer !== r) return;
      for (const t of collectTextures(this.scene)) r.initTexture(t);
      r.render(this.scene, this.cam);
      this.programsAfterWarm = r.info.programs?.length ?? 0;
      c.style.visibility = '';
      this.last = performance.now();
      r.setAnimationLoop(this.loop);
    });
    return this.ready;
  }

  /** Free the GPU (a camera mode is about to run; phones cannot hold two big contexts). */
  releaseRenderer(): void {
    const r = this.renderer;
    if (!r) return;
    r.setAnimationLoop(null);
    this.sh.bear()?.releaseRenderer?.(r);
    this.unbind?.();
    this.unbind = null;
    this.ro?.disconnect();
    this.ro = null;
    this.env?.dispose();
    this.env = null;
    this.scene.environment = null;
    r.dispose();
    r.forceContextLoss();
    this.canvas?.remove();
    this.canvas = null;
    this.renderer = null;
    this.ready = null;
  }

  private resize(): void {
    const r = this.renderer;
    if (!r) return;
    const w = Math.max(1, this.sh.container.clientWidth), h = Math.max(1, this.sh.container.clientHeight);
    r.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.fov = w < h ? FOV_WIDE : FOV_LAND;
    this.cam.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ splash framing
  /** Frame the bear inside this CSS rect (the splash hero window); null = play framing. */
  setHero(rect: DOMRect | null): void {
    if (rect && rect.width > 10 && rect.height > 10) {
      const cr = this.sh.container.getBoundingClientRect();
      this.hero = { x: rect.left - cr.left, y: rect.top - cr.top, w: rect.width, h: rect.height };
      this.framingTo = 1;
      this.framing = 1;
    } else {
      this.framingTo = 0;
      if (this.sh.reduced) this.framing = 0;
    }
  }

  // ------------------------------------------------------------------ Mode
  async enter(_from: ExperienceMode | null): Promise<void> {
    await this.ensureRenderer();
    const bear = this.sh.bear();
    if (bear && !this.stage.actor.attached) this.stage.actor.attach(bear);
    this.active = true;
    this.setHero(null);
    this.stick = this.sh.hud.joystick(true);
    this.hintT = 5;
    this.sh.hud.hint(IS_PHONE ? 'Drag to look around' : 'Drag to look, arrows walk');
  }

  exit(_to: ExperienceMode): void {
    this.active = false;
    this.runner.cancel();
    this.sh.hud.joystick(false);
    this.sh.hud.hint('');
    this.stick = null;
  }

  /** Splash preview: draw the bear (idle) before Start. */
  preview(): void {
    const bear = this.sh.bear();
    if (bear && !this.stage.actor.attached) this.stage.actor.attach(bear);
  }

  trigger(name: string): boolean {
    return this.runner.trigger(name);
  }

  reset(): void {
    this.runner.reset();
    const a = this.stage.actor;
    a.position.set(0, 0, 0);
    a.setHeading(0);
    this.yaw = 0;
    this.pitch = PLAY.pitch;
    this.dist = PLAY.dist;
    this.target.set(0, PLAY.targetY, 0);
  }

  update(): void {
    /* driven by its own animation loop */
  }

  private loop = (): void => {
    const r = this.renderer;
    if (!r) return;
    const t = performance.now();
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.fps += ((dt > 0 ? 1 / dt : 60) - this.fps) * 0.05;
    this.last = t;
    this.adapt(dt);
    const st = this.stage, a = st.actor;
    if (this.active) {
      // walking: joystick (or keys) relative to the camera
      const sv = this.stick?.active ? this.stick.vector : this.keys.vector;
      this.cam.getWorldDirection(this.dir).setY(0);
      if (this.dir.lengthSq() < 1e-6) this.dir.set(0, 0, -1);
      this.dir.normalize();
      const right = this.tmp.set(-this.dir.z, 0, this.dir.x);
      this.v.copy(right).multiplyScalar(sv.x).addScaledVector(this.dir, -sv.y);
      if (this.v.lengthSq() > 0.01 && a.asleep) this.runner.nudge();
      a.drive(this.v, dt, (p) => {
        const l = Math.hypot(p.x, p.z);
        if (l > LIM.area) { p.x *= LIM.area / l; p.z *= LIM.area / l; }
      });
      if (this.hintT > 0 && (this.hintT -= dt) <= 0) this.sh.hud.hint('');
    }
    this.runner.update(dt);
    // camera follows her
    this.target.x += (a.position.x - this.target.x) * damp(3.5, dt);
    this.target.z += (a.position.z - this.target.z) * damp(3.5, dt);
    this.framing += (this.framingTo - this.framing) * (this.framingTo < this.framing ? damp(3.2, dt) : 1);
    // pull back a little while a big moment plays (the house, the party set, the rainbow, a lap)
    const wantWide = WIDE[this.runner.current ?? ''] ?? 0;
    this.wide += (wantWide - this.wide) * damp(wantWide > this.wide ? 2.2 : 1.2, dt);
    this.placeCamera(dt);
    st.root.updateMatrixWorld();
    st.update(dt, this.cam);
    this.scene.backgroundIntensity = st.bg;
    a.update(dt, this.active ? this.cam.position : null);
    r.render(this.scene, this.cam);
  };

  private placeCamera(_dt: number): void {
    const k = ease.inOut(this.framing);
    // play framing
    const yaw = this.yaw * (1 - k), pitch = this.pitch * (1 - k) + 0.08 * k;
    let dist = this.dist + this.wide;
    let ty = PLAY.targetY + this.wide * 0.18;
    const W = Math.max(1, this.sh.container.clientWidth), H = Math.max(1, this.sh.container.clientHeight);
    if (this.hero && k > 0.001) {
      // splash framing: bear (1 unit + a margin) fills the hero window's height, centred in it
      const want = 1.22 / (2 * Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2))) * (H / Math.max(60, this.hero.h));
      const wantW = 1.0 / (2 * Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2)) * (W / H)) * (W / Math.max(60, this.hero.w));
      dist = dist * (1 - k) + Math.max(want, wantW) * k;
      ty = PLAY.targetY * (1 - k) + 0.52 * k;
      const ox = (W / 2 - (this.hero.x + this.hero.w / 2)) * k, oy = (H / 2 - (this.hero.y + this.hero.h / 2)) * k;
      this.cam.setViewOffset(W, H, ox, oy, W, H);
    } else if (this.cam.view) this.cam.clearViewOffset();
    const tgt = this.tmp.set(this.target.x, ty, this.target.z);
    this.cam.position.set(
      tgt.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      tgt.y + Math.sin(pitch) * dist,
      tgt.z + Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    this.cam.lookAt(tgt);
    this.cam.updateMatrixWorld();
  }

  /** Halve the pixel ratio once if frames are slow (phones with big screens). */
  private adapt(dt: number): void {
    if (this.dpr <= 1.25 || !this.renderer) return;
    this.frames++;
    if (this.frames < 60) return;
    this.slow = this.slow * 0.97 + (dt > 0.026 ? 0.03 : 0);
    if (this.slow > 0.5) {
      this.dpr = 1.25;
      this.renderer.setPixelRatio(this.dpr);
      this.resize();
    }
  }

  private ray = new THREE.Raycaster();
  private tap(x: number, y: number): void {
    if (!this.active || !this.canvas) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.ray.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.cam);
    const a = this.stage.actor;
    if (!a.bear) return;
    // her body: a capsule-ish box around her spot (the skinned mesh bounds are unreliable for raycasts)
    const box = new THREE.Box3(new THREE.Vector3(-0.32, 0, -0.32).add(a.position), new THREE.Vector3(0.32, 1.02, 0.32).add(a.position));
    if (!this.ray.ray.intersectsBox(box)) return;
    const name = a.asleep ? 'WakeUp' : TAP_REACTIONS[Math.floor(Math.random() * TAP_REACTIONS.length)];
    if (this.runner.busy && !a.asleep) return;
    if (this.runner.trigger(name)) this.sh.tapAction(name);
  }

  dispose(): void {
    this.releaseRenderer();
    this.keys.dispose();
  }
}

const TAP_REACTIONS = ['Wave', 'Cheer', 'Sparkle'];
const WIDE: Record<string, number> = { House: 3.4, Party: 1.6, Rainbow: 1.0, Running: 1.2, Magic: 0.8, Cold: 0.6 };

/** A soft white cloud under her (one colour fading out), so walking reads against the far-away panorama. */
function cloudFloor(): THREE.Mesh {
  const n = 128, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!, img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
    const a = d >= 1 ? 0 : Math.min(1, Math.pow(1 - d, 0.8) * 1.4);
    img.data.set([255, 247, 252, Math.round(a * 255)], (y * n + x) * 4);
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(5.2, 64),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.78, depthWrite: false, toneMapped: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = -3;
  m.name = 'cloud-floor';
  // CircleGeometry UVs map the square texture onto the disc
  return m;
}

function collectTextures(root: THREE.Object3D): THREE.Texture[] {
  const out = new Set<THREE.Texture>();
  root.traverse((o) => {
    for (const m of ([] as THREE.Material[]).concat(((o as THREE.Mesh).material as THREE.Material) ?? [])) {
      for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture && !(v as THREE.VideoTexture).isVideoTexture) out.add(v as THREE.Texture);
    }
  });
  return [...out];
}
