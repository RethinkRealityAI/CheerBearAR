// Selfie with Cheer Bear (front camera, face effects). Port of the Mattercraft "Face-filter" scene, improved.
//
//   intro     Cheer Bear's wink clip over the camera (green keyed in the scene, flat threshold) with the title cloud.
//             First visit only, tap to skip; reduced motion shows the still of her peace sign and moves on sooner.
//   live      bear ears, heart nose and cheek hearts on your face; the title cloud on top; and either the 3D Cheer Bear
//             beside you (the shared rigged bear: waves hello, cheers for the photo, keeps lip-syncing on a call) or
//             the classic look (the old filter's peace-sign art). The look picker sits above the shutter.
//   countdown the shutter starts a visible 5 s timer; tapping it again shoots at once.
//   review    camera + 3D + frame art in one JPEG (the selfie is the mirror image you saw; the art is never mirrored),
//             Save / Share / Retake / Watch photo animation / Behind the scenes.
import * as THREE from 'three';
import type { BearClip, ExperienceMode } from '../../../shared/contracts';
import type { FaceEvent, Mode, ModeContext, XrScene } from '../../types';
import {
  BtsPlayer, Countdown, RevealPlayer, ReviewSheet, chromaMaterial, compose, engineShot, flash, el, loadImage, segmented,
} from '../../capture';
import { drawFrameArt, loadFrameArt } from '../../capture/frame-art';
import { FaceFx } from './face-fx';

const WINK_URL = '/media/capture/wink.mp4';
const STILL_URL = '/img/capture/wink-still.webp';
const COUNTDOWN_S = 5;
const INTRO_MAX_S = 7;
const STILL_S = 1.6;

type State = 'off' | 'intro' | 'live' | 'countdown' | 'busy' | 'review';
type Look = '3d' | 'classic';

// trigger words -> what the selfie bear does
const REACT: Record<string, BearClip> = {
  wave: 'wave', dance: 'dance', party: 'dance', cold: 'shiver',
  cheer: 'cheer', sparkle: 'cheer', magic: 'cheer', rainbow: 'cheer', house: 'cheer', running: 'cheer', wakeup: 'cheer',
};

export class FaceMode implements Mode {
  readonly id = 'face' as ExperienceMode;
  readonly camera = 'face' as const;
  readonly root = new THREE.Group();
  state: State = 'off';
  look: Look = '3d';
  introDone = false;
  faceFound = false;
  /** Test hooks. */
  readonly diag = { shots: 0, lastPhoto: null as Blob | null, introPlayed: 0, introSkipped: 0, faceEvents: 0, soundPrimed: false };

  private cam = new THREE.Group(); // follows the engine camera: screen-anchored things
  private anchor = new THREE.Group(); // follows the face
  private fx = new FaceFx();
  private bearHolder = new THREE.Group();
  private introQuad: THREE.Mesh;
  private introMat: THREE.ShaderMaterial;
  private video: HTMLVideoElement;
  private videoTex: THREE.VideoTexture;
  private target = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1, fresh: false };
  // HUD
  private overlay: HTMLCanvasElement;
  private shutterBtn: HTMLButtonElement | null = null;
  private picker: { el: HTMLElement; set(id: string): void };
  private skipBtn: HTMLButtonElement;
  private still: HTMLImageElement | null = null;
  private countdown: Countdown | null = null;
  private review: ReviewSheet;
  private reveal: RevealPlayer;
  private bts: BtsPlayer;
  private introTimer = 0;
  private cheered = false;
  private lastReact = 0;
  private resizeObs: ResizeObserver | null = null;
  private titleTop = 0.09;
  private wp = new THREE.Vector3();
  private unprime: (() => void) | null = null;

  constructor(private ctx: ModeContext) {
    this.root.name = 'face-root';
    this.root.visible = false;
    // the stages' two lights, so the borrowed bear's shaders are the ones already compiled (no recompile on enter)
    const hemi = new THREE.HemisphereLight(0xffffff, 0xc8a8bc, 1.25);
    const sun = new THREE.DirectionalLight(0xfff3e6, 1.7);
    sun.position.set(0.6, 1.4, 1.2);
    this.root.add(hemi, sun, this.cam, this.anchor);
    this.anchor.add(this.fx.group);
    this.anchor.visible = false;
    this.bearHolder.name = 'face-bear';
    this.cam.add(this.bearHolder);

    // intro clip: a camera-facing quad, keyed in the shader (compiled with the root at engine start)
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    v.style.cssText = 'position:absolute;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    this.video = v;
    this.videoTex = new THREE.VideoTexture(v);
    this.videoTex.minFilter = THREE.LinearFilter;
    this.videoTex.generateMipmaps = false;
    this.introMat = chromaMaterial(this.videoTex);
    this.introQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.introMat);
    this.introQuad.renderOrder = 100;
    this.introQuad.frustumCulled = false;
    this.introQuad.visible = false;
    this.introQuad.name = 'intro-clip';
    this.cam.add(this.introQuad);

    this.overlay = el('canvas', 'cbc-overlay');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.picker = segmented('Selfie look', [{ id: '3d', label: '3D bear' }, { id: 'classic', label: 'Classic' }], this.look, (id) => this.setLook(id as Look));
    this.skipBtn = el('button', 'cbc-skip', 'Skip');
    this.skipBtn.type = 'button';
    this.skipBtn.setAttribute('aria-label', 'Skip the intro');
    this.skipBtn.addEventListener('click', (e) => { e.stopPropagation(); this.skipIntro(); });

    const name = 'cheer-bear-selfie';
    this.review = new ReviewSheet({
      container: ctx.container,
      name,
      title: 'Your selfie',
      share: { title: 'Me and Cheer Bear', text: 'My selfie with Cheer Bear!' },
      onRetake: () => this.toLive(false),
      onReveal: (b) => this.reveal.play(b),
      onBts: () => this.bts.play(),
    });
    this.reveal = new RevealPlayer(ctx.container, name);
    this.bts = new BtsPlayer(ctx.container);
  }

  // ------------------------------------------------------------------ Mode
  async load(): Promise<void> {
    this.video.src = WINK_URL;
    this.ctx.container.appendChild(this.video); // iOS: in the document, or the texture stays black
    // the tap on "Selfie" lets the wink play with sound later (iOS: play unmuted + pause inside the tap)
    const onClick = (e: Event) => {
      const t = (e.target as HTMLElement | null)?.closest?.('[data-mode="face"]');
      if (t && !this.introDone && !this.ctx.reducedMotion) this.primeSound();
    };
    this.ctx.container.addEventListener('click', onClick, true);
    this.unprime = () => this.ctx.container.removeEventListener('click', onClick, true);
    await Promise.all([loadFrameArt(), this.ctx.reducedMotion ? loadImage(STILL_URL) : null]);
  }

  onScene(_xr: XrScene): void {
    /* root is re-added by the engine; everything follows the camera / face each frame */
  }

  enter(_from: ExperienceMode | null): void {
    this.root.visible = true;
    this.anchor.visible = false;
    this.faceFound = false;
    const hud = this.ctx.hud;
    this.countdown = new Countdown(hud.layer, this.ctx.reducedMotion);
    hud.layer.appendChild(this.overlay);
    this.measureTitle();
    this.drawOverlay();
    this.resizeObs = new ResizeObserver(() => { this.measureTitle(); this.drawOverlay(); });
    this.resizeObs.observe(this.ctx.container);
    this.borrowBear();
    hud.hint('Look at the camera');
    if (!this.introDone) this.startIntro();
    else {
      this.state = 'live';
      this.toLive(true);
    }
  }

  exit(_to: ExperienceMode): void {
    this.state = 'off';
    this.stopIntro();
    this.countdown?.dispose();
    this.countdown = null;
    this.review.close();
    this.reveal.close();
    this.bts.close();
    this.shutterBtn?.remove();
    this.shutterBtn = null;
    this.picker.el.remove();
    this.skipBtn.remove();
    this.overlay.remove();
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.returnBear();
    this.root.visible = false;
    this.anchor.visible = false;
    this.ctx.hud.hint('');
  }

  update(dt: number): void {
    const xr = this.ctx.engine.xr;
    if (!xr || this.state === 'off') return;
    const cam = xr.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(this.cam.position);
    cam.getWorldQuaternion(this.cam.quaternion);
    const P = cam.projectionMatrix.elements;
    const tanY = 1 / (P[5] || 1), tanX = 1 / (P[0] || 1);

    if (this.introQuad.visible) {
      // cover the screen with the 9:16 clip at 1 m
      const hw = tanX, hh = tanY, a = 9 / 16;
      let w = 2 * hw, h = w / a;
      if (h < 2 * hh) { h = 2 * hh; w = h * a; }
      this.introQuad.position.set(0, 0, -1);
      this.introQuad.scale.set(w, h, 1);
    }

    // the 3D bear: big, bottom left, peeking in beside you (like the old art), turned towards the middle
    if (this.bearHolder.visible) {
      const d = 1.3, hh = d * tanY, hw = d * tanX;
      const H = hh * Math.min(1.08, (hw / hh) * 2.3); // head about 45 % of the width on a phone, less on wide screens
      const top = -hh + 0.88 * hh; // top of her head ~44 % up the screen
      this.bearHolder.position.set(-hw + 0.42 * hw, top - H, -d);
      this.bearHolder.scale.setScalar(H);
      this.bearHolder.rotation.set(0, 0.5, 0);
    }

    // face anchor: smoothed towards the latest engine transform (snap when first found)
    if (this.target.fresh) {
      const k = 1 - Math.exp(-dt * 30);
      this.anchor.position.lerp(this.target.pos, k);
      this.anchor.quaternion.slerp(this.target.quat, k);
      const s = this.anchor.scale.x + (this.target.scale - this.anchor.scale.x) * k;
      this.anchor.scale.setScalar(s);
    }
    this.fx.update(dt, this.ctx.reducedMotion);

    const bear = this.ctx.bear;
    if (bear && bear.object.parent === this.bearHolder) {
      bear.lookAt(cam.getWorldPosition(this.wp));
      bear.update(dt);
    }
  }

  onFace(ev: FaceEvent): void {
    this.diag.faceEvents++;
    if (ev.type === 'found' || ev.type === 'updated') {
      const t = ev.detail?.transform;
      if (!t) return;
      this.target.pos.set(t.position.x, t.position.y, t.position.z);
      this.target.quat.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
      this.target.scale = t.scale ?? 1;
      this.fx.place(ev.detail?.attachmentPoints ?? null);
      if (!this.faceFound) {
        this.faceFound = true;
        this.anchor.position.copy(this.target.pos);
        this.anchor.quaternion.copy(this.target.quat);
        this.anchor.scale.setScalar(this.target.scale);
        this.anchor.visible = true;
        this.fx.pop();
        if (this.state !== 'intro') this.ctx.hud.hint('');
      }
      this.target.fresh = true;
    } else if (ev.type === 'lost') {
      this.faceFound = false;
      this.target.fresh = false;
      this.anchor.visible = false;
      if (this.state === 'live') this.ctx.hud.hint('Look at the camera');
    }
  }

  onTap(): boolean {
    if (this.state === 'intro') {
      this.skipIntro();
      return true;
    }
    return false;
  }

  trigger(name: string): boolean {
    const bear = this.ctx.bear;
    if (!bear || this.look !== '3d' || (this.state !== 'live' && this.state !== 'countdown')) return false;
    const clip = REACT[name.toLowerCase().replace(/\s+/g, '')];
    if (!clip) return false;
    const t = performance.now();
    if (t - this.lastReact < 1200) return false;
    this.lastReact = t;
    bear.play(clip, { once: true, fade: 0.25 });
    return true;
  }

  reset(): void {
    this.introDone = false;
    this.look = '3d';
    this.picker.set('3d');
    if (this.state !== 'off') this.setLook('3d');
  }

  dispose(): void {
    this.exit('showcase');
    this.unprime?.();
    try { this.video.pause(); } catch { /* none */ }
    this.video.removeAttribute('src');
    this.video.remove();
    this.videoTex.dispose();
  }

  // ------------------------------------------------------------------ intro
  private primeSound(): void {
    const v = this.video;
    try {
      v.muted = false;
      const p = v.play();
      v.pause();
      this.diag.soundPrimed = true;
      p?.catch((e: Error) => { if (e?.name !== 'AbortError') { this.diag.soundPrimed = false; v.muted = true; } });
    } catch {
      this.diag.soundPrimed = false;
      v.muted = true;
    }
  }

  private startIntro(): void {
    this.state = 'intro';
    this.bearHolder.visible = false;
    this.diag.introPlayed++;
    this.drawOverlay();
    this.ctx.hud.above.appendChild(this.skipBtn);
    if (this.ctx.reducedMotion) {
      // a still of her peace sign, then on (no motion, no sound)
      const img = el('img', 'cbc-still');
      img.src = STILL_URL;
      img.alt = '';
      this.ctx.hud.layer.insertBefore(img, this.overlay);
      this.still = img;
      this.introTimer = window.setTimeout(() => this.endIntro(), STILL_S * 1000);
      return;
    }
    const v = this.video;
    v.currentTime = 0;
    v.muted = !this.diag.soundPrimed;
    v.onended = () => this.endIntro();
    this.introQuad.visible = true;
    void v.play().catch(() => {
      v.muted = true;
      return v.play();
    }).catch(() => this.endIntro());
    this.introTimer = window.setTimeout(() => this.endIntro(), INTRO_MAX_S * 1000);
  }

  private skipIntro(): void {
    if (this.state !== 'intro') return;
    this.diag.introSkipped++;
    this.endIntro();
  }

  private stopIntro(): void {
    clearTimeout(this.introTimer);
    const v = this.video;
    v.onended = null;
    try { v.pause(); } catch { /* none */ }
    v.muted = true;
    this.introQuad.visible = false;
    this.still?.remove();
    this.still = null;
    this.skipBtn.remove();
  }

  private endIntro(): void {
    if (this.state !== 'intro') return;
    this.stopIntro();
    try { this.video.currentTime = 0; } catch { /* none */ }
    this.introDone = true;
    this.toLive(true);
  }

  // ------------------------------------------------------------------ live / capture
  private toLive(hello: boolean): void {
    if (this.state === 'off') return;
    this.state = 'live';
    const hud = this.ctx.hud;
    if (!this.shutterBtn) this.shutterBtn = hud.shutter(() => this.onShutter(), 'Take a selfie with Cheer Bear');
    this.shutterBtn.disabled = false;
    this.shutterBtn.classList.remove('cbc-armed');
    this.shutterBtn.setAttribute('aria-label', 'Take a selfie with Cheer Bear');
    if (this.shutterBtn.parentElement !== hud.centre) hud.centre.appendChild(this.shutterBtn);
    hud.above.appendChild(this.picker.el);
    this.setLook(this.look);
    hud.hint(this.faceFound ? '' : 'Look at the camera');
    const bear = this.ctx.bear;
    if (hello && bear && this.look === '3d') bear.play('wave', { once: true, fade: 0.3 });
  }

  private setLook(l: Look): void {
    this.look = l;
    this.bearHolder.visible = l === '3d' && this.state !== 'intro';
    this.drawOverlay();
  }

  private onShutter(): void {
    if (this.state === 'countdown') {
      this.countdown?.now();
      return;
    }
    if (this.state !== 'live' || !this.countdown) return;
    this.state = 'countdown';
    this.cheered = false;
    this.picker.el.remove();
    this.ctx.hud.hint('');
    const b = this.shutterBtn!;
    b.classList.add('cbc-armed');
    b.setAttribute('aria-label', 'Take the photo now');
    void this.countdown
      .start(COUNTDOWN_S, (left) => { if (!this.cheered && left <= 1.3) this.cheer(); })
      .then((go) => (go ? this.shoot() : this.toLive(false)));
  }

  private cheer(): void {
    this.cheered = true;
    const bear = this.ctx.bear;
    if (bear && this.look === '3d' && bear.object.parent === this.bearHolder) bear.play('cheer', { once: true, fade: 0.2 });
  }

  private async shoot(): Promise<void> {
    if (this.state !== 'countdown') return;
    this.state = 'busy';
    const b = this.shutterBtn;
    if (b) { b.disabled = true; b.classList.remove('cbc-armed'); }
    try {
      if (!this.cheered) {
        this.cheer();
        await new Promise((r) => setTimeout(r, 380)); // let her arms come up
      }
      if (this.state !== 'busy') return; // left the mode meanwhile
      flash(this.ctx.container, this.ctx.reducedMotion);
      const img = await engineShot(this.ctx.engine);
      if (this.state !== 'busy') return;
      const look = this.look, top = this.titleTop;
      const { blob } = await compose(img, (g, w, h) => drawFrameArt(g, w, h, { title: true, titleTop: top, peace: look === 'classic' }));
      img.src = '';
      if (this.state !== 'busy') return;
      this.diag.shots++;
      this.diag.lastPhoto = blob;
      this.ctx.capture(blob);
      this.state = 'review';
      this.review.show(blob);
    } catch (e) {
      console.warn('[selfie] photo failed', e);
      this.ctx.hud.toast('That photo did not work. Try again?', 2200);
      this.toLive(false);
    }
  }

  // ------------------------------------------------------------------ bear + overlay
  private borrowBear(): void {
    const bear = this.ctx.bear;
    if (!bear) return;
    const o = bear.object;
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    o.scale.setScalar(1 / (bear.height || 1));
    o.userData.cbxOwnGpu = !!bear.releaseRenderer;
    this.bearHolder.add(o);
    bear.play('idle', { fade: 0.2 });
  }

  private returnBear(): void {
    const bear = this.ctx.bear;
    if (bear && bear.object.parent === this.bearHolder) this.bearHolder.remove(bear.object);
  }

  /** The title cloud sits just under the HUD's top bar (same share of the height in the photo). */
  private measureTitle(): void {
    const c = this.ctx.container;
    const h = c.clientHeight || 1;
    const bar = c.querySelector('.cbx-top') as HTMLElement | null;
    const bottom = bar ? bar.getBoundingClientRect().bottom - c.getBoundingClientRect().top : 64;
    this.titleTop = Math.min(0.2, Math.max(0.06, (bottom + 6) / h));
  }

  private drawOverlay(): void {
    const c = this.overlay;
    const box = this.ctx.container;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(box.clientWidth * dpr)), h = Math.max(1, Math.round(box.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    if (this.state === 'off') return;
    drawFrameArt(g, w, h, { title: true, titleTop: this.titleTop, peace: this.look === 'classic' && this.state !== 'intro' });
  }
}

export function createMode(ctx: ModeContext): Mode {
  return new FaceMode(ctx);
}
export default createMode;
