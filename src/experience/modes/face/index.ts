// Selfie with Cheer Bear (front camera, face effects). Port of the Mattercraft "Face-filter" scene, improved.
//
//   live      bear ears, heart nose and cheek hearts on your face; the title cloud on top; one of two looks:
//     3D bear   the shared rigged bear, big, bottom left. She is an OVERLAY: drawn last, after a depth clear, so she is
//               always in front of you and the face effects (the head occluder only hides things behind YOUR head).
//               She says hello, mirrors you (smile -> she beams, mouth wide -> she gasps, wink -> she winks back,
//               eyebrows up -> surprised, head tilt -> she tilts hers; all gated, see signals.ts), cheers for the
//               photo, keeps lip-syncing on a call. Shutter: a visible 5 s countdown, a second tap shoots at once.
//     Classic   the old filter's video: Cheer Bear slides in, waves and ends on a wink with a peace sign. Choosing
//               Classic (a tap) plays it WITH sound over the camera, keyed in the scene. On its last frame she holds
//               the pose (the video stays paused on it) while "Smile!" then a big 3, 2, 1 count you in (soft ticks),
//               then a flash + shutter sound and the photo, with her in it exactly as on screen. (polish-4: the clip
//               itself has no countdown; round 2 assumed it did, so nothing was shown between her pose and the photo.)
//               The shutter shoots at once during the 3-2-1 and plays the clip again for another take afterwards.
//               Autoplay refused -> a "Tap to play" button.
//     Just me   no bear: you, the face effects, the frame (round 5: the show / hide-the-bear option, as on Happi).
//   frames    round 5 (camera-5, ported from the Happi demo): live frame + filter chips above the shutter (Rainbow,
//             Clouds, Hearts, Clean | Natural, Warm, Candy, Mono). The frame draws on the overlay at once, the filter
//             is a CSS look on the camera canvas; both are baked into the photo and the video exactly.
//             polish-6 (round 6): one row at a time, from a compact "Frame · Rainbow | Filter · Natural" toggle under
//             the look picker (folded by default; a tap on the camera view folds it). The title cloud is part of the
//             frame at the TOP of the picture (frame-art.ts titleAt 'top-edge'); on screen it sits just under the
//             top bar (the lockup is hidden in Selfie, the cloud is the branding).
//   shutter   tap = photo (the countdown as before); press and hold = a video clip (frame, filter, title and the
//             experience's sound in it; capture/recorder.ts), up to 30 s, then the review plays it inline.
//   smile     optional "Smile" switch (bottom left, off by default): a held smile starts the shot.
//   review    camera + 3D (+ the keyed clip) + frame + filter + the title art in one JPEG (the selfie is the mirror
//             image you saw; the art is never mirrored): Retake / Save / Share / Watch photo animation / Behind the scenes.
import * as THREE from 'three';
import type { BearClip, BearExpression, ExperienceMode } from '../../../shared/contracts';
import type { FaceEvent, Mode, ModeContext, XrScene } from '../../types';
import {
  BtsPlayer, CICON, Countdown, RevealPlayer, ReviewSheet, chromaMaterial, compose, engineShot, flash, el, segmented,
} from '../../capture';
import { drawFrameArt, loadFrameArt, type FrameStyle, type PhotoFilter } from '../../capture/frame-art';
import { styleStrip, FILTER_CSS, type StyleStrip } from '../../capture/style-strip';
import { clipHold, recorder } from '../../capture/recorder';
import { shutterSound } from '../../capture/sounds';
import { FaceFx } from './face-fx';
import { FaceSignals, type FaceCue } from './signals';

const WINK_URL = '/media/capture/wink.mp4';
const COUNTDOWN_S = 5;
const SMILE_COUNTDOWN_S = 3;
/** She holds her last pose this long before "Smile!" (the clip ends on her wink + peace sign). */
const CLIP_HOLD_MS = 250;
/** Classic, after her pose: "Smile!" for this long, then 3, 2, 1. */
const CLASSIC_LEAD_S = 1.1;
const CLASSIC_COUNT_S = 3;
/** Draw order of the 3D bear: after everything else, behind a depth clear. */
const OVERLAY_ORDER = 1000;

type State = 'off' | 'live' | 'countdown' | 'clip' | 'busy' | 'review' | 'recording';
/** 3D bear beside you, the Classic clip, or just you (no bear). */
type Look = '3d' | 'classic' | 'none';

// trigger words -> what the selfie bear does
const REACT: Record<string, BearClip> = {
  wave: 'wave', dance: 'dance', party: 'dance', cold: 'shiver',
  cheer: 'cheer', sparkle: 'cheer', magic: 'cheer', rainbow: 'cheer', house: 'cheer', running: 'cheer', wakeup: 'cheer',
};

const SMILE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8 14c1 1.6 2.4 2.4 4 2.4s3-.8 4-2.4"/><path d="M9 9.5v.5M15 9.5v.5"/></svg>';

/** The title cloud's width as a share of the picture (polish-6: a little smaller, so it frames rather than covers). */
const TITLE_W = 0.5;

export class FaceMode implements Mode {
  readonly id = 'face' as ExperienceMode;
  readonly camera = 'face' as const;
  readonly root = new THREE.Group();
  state: State = 'off';
  look: Look = '3d';
  faceFound = false;
  smileSnap = false;
  /** Test hooks. */
  readonly diag = {
    shots: 0, clips: 0, lastPhoto: null as Blob | null, lastClip: null as Blob | null, faceEvents: 0, soundPrimed: false,
    clipPlays: 0, clipEnds: 0, clipAutoShots: 0, clipBlocked: 0, clipMuted: false, clipT: 0, clipCounts: 0,
    reactions: {} as Record<string, number>, expression: 'neutral' as BearExpression, smileShots: 0,
    overlayClears: 0, attachmentKeys: [] as string[],
  };
  readonly signals: FaceSignals;

  private cam = new THREE.Group(); // follows the engine camera: screen-anchored things
  private anchor = new THREE.Group(); // follows the face
  private fx = new FaceFx();
  private bearHolder = new THREE.Group();
  private clipQuad: THREE.Mesh;
  private clipMat: THREE.ShaderMaterial;
  private video: HTMLVideoElement;
  private videoTex: THREE.VideoTexture;
  private target = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1, fresh: false };
  // HUD
  private overlay: HTMLCanvasElement;
  private shutterBtn: HTMLButtonElement | null = null;
  private picker: { el: HTMLElement; set(id: string): void };
  /** The live frame + filter chips above the shutter (round 5: pick them while framing, not after). */
  private strip: StyleStrip;
  private tint: HTMLElement;
  frame: FrameStyle = 'rainbow';
  filter: PhotoFilter = 'natural';
  private smileBtn: HTMLButtonElement;
  private tapPlay: HTMLButtonElement;
  private countdown: Countdown | null = null;
  private review: ReviewSheet;
  private reveal: RevealPlayer;
  private bts: BtsPlayer;
  private clipTimer = 0;
  private clipWatch = 0;
  private cheered = false;
  private lastReact = 0;
  private resizeObs: ResizeObserver | null = null;
  /** A tap anywhere but the frame / filter controls folds the open chip row away (polish-6). */
  private foldTap = (e: Event) => {
    const t = e.target as Node | null;
    if (!this.strip.opened || !t || this.strip.el.contains(t) || this.strip.toggle.contains(t)) return;
    this.strip.open(null);
  };
  private titleTop = 0.09;
  private wp = new THREE.Vector3();
  private unprime: (() => void) | null = null;
  private lastPhoto: Blob | null = null;
  // the bear's live reactions
  private headBone: THREE.Object3D | null = null;
  private tilt = 0;
  private bounce = 0; // 0..1 decaying "beam" bounce
  private recoil = 0; // 0..1 decaying "gasp" recoil
  private smileHeldAt = 0;
  private smileArmed = true;
  private q1 = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v1 = new THREE.Vector3();

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
    this.signals = new FaceSignals((c) => this.onCue(c));

    // The 3D bear is a layer in front of the camera AND your face: everything else draws first (render order), then
    // this invisible triangle clears the depth buffer, then the bear (render order OVERLAY_ORDER) draws on top. The
    // face effects keep their own occlusion against the head occluder; the bear ignores it.
    const clear = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }),
    );
    clear.name = 'bear-depth-clear';
    clear.frustumCulled = false;
    clear.renderOrder = OVERLAY_ORDER - 1;
    clear.onBeforeRender = (renderer) => {
      renderer.state.buffers.depth.setMask(true);
      renderer.clearDepth();
      this.diag.overlayClears++;
    };
    this.bearHolder.add(clear);

    // the Classic clip: a camera-facing quad, keyed in the shader (compiled with the root at engine start)
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
    this.clipMat = chromaMaterial(this.videoTex, { texel: [1 / 720, 1 / 1280] }); // wink.mp4 is 720x1280
    this.clipQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.clipMat);
    this.clipQuad.renderOrder = 100;
    this.clipQuad.frustumCulled = false;
    this.clipQuad.visible = false;
    this.clipQuad.name = 'classic-clip';
    this.cam.add(this.clipQuad);

    this.overlay = el('canvas', 'cbc-overlay');
    this.overlay.setAttribute('aria-hidden', 'true');
    // choosing Classic is a tap: the clip starts (with sound) inside it
    this.picker = segmented('Selfie look', [{ id: '3d', label: '3D bear' }, { id: 'classic', label: 'Classic' }, { id: 'none', label: 'Just me' }], this.look, (id) => this.setLook(id as Look, true));
    this.picker.el.classList.add('cbc-look');
    this.strip = styleStrip(this.frame, this.filter, (frame, filter) => {
      this.frame = frame;
      this.filter = filter;
      this.drawOverlay();
      this.liveFilter();
    });
    this.tint = el('div', 'cbc-tint');
    this.tint.setAttribute('aria-hidden', 'true');
    this.smileBtn = ctx.hud.toolButton({ label: 'Smile', icon: SMILE_ICON, aria: 'Smile to take the photo', onClick: () => this.toggleSmileSnap() });
    this.smileBtn.setAttribute('aria-pressed', 'false');
    this.smileBtn.classList.add('cbc-toggle');
    this.tapPlay = el('button', 'cbc-tapplay', `${CICON.play}<span>Tap to play</span>`);
    this.tapPlay.type = 'button';
    this.tapPlay.setAttribute('aria-label', 'Play Cheer Bear’s video');
    this.tapPlay.addEventListener('click', (e) => { e.stopPropagation(); this.playClip(); });

    const name = 'cheer-bear-selfie';
    this.review = new ReviewSheet({
      container: ctx.container,
      name,
      title: 'Your selfie',
      share: { title: 'Me and Cheer Bear', text: 'My selfie with Cheer Bear!' },
      onRetake: () => this.toLive(false),
      onReveal: (b) => this.reveal.play(b),
      onBts: () => this.bts.play(this.lastPhoto),
    });
    this.reveal = new RevealPlayer(ctx.container, name);
    this.bts = new BtsPlayer(ctx.container);
  }

  // ------------------------------------------------------------------ Mode
  async load(): Promise<void> {
    this.video.src = WINK_URL;
    this.ctx.container.appendChild(this.video); // iOS: in the document, or the texture stays black
    // the tap on "Selfie" lets the Classic clip play with sound when the mode opens in Classic (iOS: play unmuted +
    // pause inside the tap unlocks this element)
    const onClick = (e: Event) => {
      const t = (e.target as HTMLElement | null)?.closest?.('[data-mode="face"]');
      if (t && this.look === 'classic') this.primeSound();
    };
    this.ctx.container.addEventListener('click', onClick, true);
    this.unprime = () => this.ctx.container.removeEventListener('click', onClick, true);
    await loadFrameArt();
  }

  onScene(_xr: XrScene): void {
    /* root is re-added by the engine; everything follows the camera / face each frame */
  }

  enter(_from: ExperienceMode | null): void {
    this.root.visible = true;
    this.anchor.visible = false;
    this.faceFound = false;
    this.signals.reset();
    const hud = this.ctx.hud;
    this.countdown = new Countdown(hud.layer, this.ctx.reducedMotion);
    hud.layer.append(this.tint, this.overlay);
    this.measureTitle();
    this.drawOverlay();
    this.liveFilter();
    this.resizeObs = new ResizeObserver(() => { this.measureTitle(); this.drawOverlay(); this.publishStripHeight(); });
    this.resizeObs.observe(this.ctx.container);
    this.resizeObs.observe(this.strip.el);
    this.resizeObs.observe(this.strip.toggle);
    this.ctx.container.addEventListener('pointerdown', this.foldTap, true);
    this.strip.open(null);
    this.borrowBear();
    this.state = 'live';
    this.toLive(true);
    if (this.look === 'classic') this.playClip();
  }

  exit(_to: ExperienceMode): void {
    if (this.state === 'recording') void recorder.stop(); // the clip is dropped (onDone sees the mode is off)
    this.state = 'off';
    this.stopClip();
    this.countdown?.dispose();
    this.countdown = null;
    this.review.close();
    this.reveal.close();
    this.bts.close();
    this.shutterBtn?.remove();
    this.shutterBtn = null;
    this.picker.el.remove();
    this.strip.open(null);
    this.strip.el.remove();
    this.strip.toggle.remove();
    this.ctx.container.removeEventListener('pointerdown', this.foldTap, true);
    this.tint.remove();
    this.liveFilter(true);
    this.smileBtn.remove();
    this.tapPlay.remove();
    this.overlay.remove();
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.ctx.container.style.removeProperty('--cbx-strip-h');
    this.ctx.container.style.removeProperty('--cbc-title-h');
    this.setExpression('neutral');
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

    if (this.clipQuad.visible) {
      // the 9:16 clip at 1 m, full screen height: covers a phone held upright (narrower than 9:16); on a wider
      // screen (tablet, landscape) it fits the height so she stays whole and the keyed camera shows at the sides
      const hh = tanY, a = 9 / 16;
      const h = 2 * hh, w = h * a;
      this.clipQuad.position.set(0, 0, -1);
      this.clipQuad.scale.set(w, h, 1);
      this.diag.clipT = +this.video.currentTime.toFixed(2);
    }

    // the 3D bear: big, bottom left, peeking in beside you (like the old art), turned towards the middle
    if (this.bearHolder.visible) {
      const d = 1.3, hh = d * tanY, hw = d * tanX;
      // round 5: a little smaller, so her face sits clear above the look picker and the frame / filter chips (her
      // body may stand behind them) and never covers yours
      const H = hh * Math.min(0.9, (hw / hh) * 1.95); // head about 38 % of the width on a phone, less on wide screens
      const top = -hh + 1.1 * hh; // top of her head ~55 % up the screen
      // live reactions: a little bounce when she beams, a small step back when she gasps, a lean with your tilt
      const kb = 1 - Math.exp(-dt * 3.2);
      this.bounce -= this.bounce * kb;
      this.recoil -= this.recoil * (1 - Math.exp(-dt * 2.4));
      const want = this.look === '3d' ? this.signals.roll : 0;
      this.tilt += (want - this.tilt) * (1 - Math.exp(-dt * 6));
      const hop = this.ctx.reducedMotion ? 0 : Math.sin(Math.min(1, 1 - this.bounce) * Math.PI) * this.bounce * 0.06;
      this.bearHolder.position.set(-hw + 0.42 * hw, top - H + hop * H, -d - this.recoil * 0.18);
      this.bearHolder.scale.setScalar(H);
      this.bearHolder.rotation.set(-this.recoil * 0.12, 0.5, this.tilt * 0.15);
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
      this.tiltHead();
    }

    // smile to snap: a held smile (about a second) starts the shot, once per smile
    if (this.smileSnap && this.state === 'live' && this.signals.smile && this.smileArmed && !this.review.open) {
      if (!this.smileHeldAt) this.smileHeldAt = performance.now();
      else if (performance.now() - this.smileHeldAt > 600) {
        this.smileArmed = false;
        this.smileHeldAt = 0;
        this.diag.smileShots++;
        if (this.look === 'classic') this.playClip();
        else this.startCountdown(SMILE_COUNTDOWN_S);
      }
    } else if (!this.signals.smile) {
      this.smileHeldAt = 0;
      this.smileArmed = true;
    }
  }

  onFace(ev: FaceEvent): void {
    this.diag.faceEvents++;
    const now = performance.now();
    if (ev.type === 'found' || ev.type === 'updated') {
      const t = ev.detail?.transform;
      if (!t) return;
      this.target.pos.set(t.position.x, t.position.y, t.position.z);
      this.target.quat.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
      this.target.scale = t.scale ?? 1;
      this.fx.place(ev.detail?.attachmentPoints ?? null);
      if (!this.diag.attachmentKeys.length && ev.detail?.attachmentPoints) this.diag.attachmentKeys = Object.keys(ev.detail.attachmentPoints);
      if (!this.faceFound) {
        this.faceFound = true;
        this.anchor.position.copy(this.target.pos);
        this.anchor.quaternion.copy(this.target.quat);
        this.anchor.scale.setScalar(this.target.scale);
        this.anchor.visible = true;
        this.fx.pop();
        this.ctx.hud.hint('');
      }
      this.target.fresh = true;
      if (this.look === '3d' || this.smileSnap) this.signals.update(ev.detail, now);
    } else if (ev.type === 'lost') {
      this.faceFound = false;
      this.target.fresh = false;
      this.anchor.visible = false;
      this.signals.lost();
      if (this.state === 'live') this.ctx.hud.hint('Look at the camera');
    } else if (ev.type === 'other') {
      this.signals.event(ev.name, now);
    }
  }

  onTap(): boolean {
    // a refused autoplay: any tap on the camera view plays the clip (it is a user gesture)
    if (this.state === 'clip' && this.tapPlay.isConnected) {
      this.playClip();
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
    this.look = '3d';
    this.picker.set('3d');
    this.setSmileSnap(false);
    if (this.state !== 'off') {
      if (this.state === 'recording') void recorder.stop();
      this.review.close();
      this.reveal.close();
      this.bts.close();
      this.countdown?.cancel();
      this.state = 'live';
      this.setLook('3d', false);
      this.toLive(false);
    }
  }

  dispose(): void {
    this.exit('showcase');
    this.unprime?.();
    try { this.video.pause(); } catch { /* none */ }
    this.video.removeAttribute('src');
    this.video.remove();
    this.videoTex.dispose();
  }

  /** Test hook: act as if your face did something (same reactions, no gates). */
  fire(cue: FaceCue | 'tilt', value = 0.3): void {
    if (cue === 'tilt') {
      this.signals.rollOverride = value || null;
      this.signals.roll = value;
      return;
    }
    this.signals.fire(cue);
  }

  // ------------------------------------------------------------------ the Classic clip
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

  /**
   * Play the Classic clip from the start, with sound. Called inside a tap (picker, shutter, Tap to play) where it can,
   * so iOS lets the sound play. When the browser still refuses, "Tap to play" shows; a second refusal plays it muted.
   */
  private playClip(): void {
    if (this.state === 'off' || this.state === 'busy' || this.state === 'review') return;
    if (this.state === 'countdown') this.countdown?.cancel();
    this.state = 'clip';
    this.setBearVisible(false);
    const v = this.video;
    const retry = this.tapPlay.isConnected;
    this.tapPlay.remove();
    clearTimeout(this.clipTimer);
    clearInterval(this.clipWatch);
    v.onended = () => this.onClipEnd();
    try { v.currentTime = 0; } catch { /* not seekable yet: starts at 0 anyway */ }
    v.muted = false;
    this.clipQuad.visible = true;
    this.armShutter(true, 'Cheer Bear takes the photo at the end');
    this.ctx.hud.hint('');
    this.diag.clipPlays++;
    this.diag.clipMuted = false;
    const p = v.play();
    p?.catch((e: Error) => {
      if (this.state !== 'clip' || e?.name === 'AbortError') return;
      this.diag.clipBlocked++;
      if (!retry) {
        // autoplay with sound refused (no gesture reached us): ask for a tap
        this.ctx.hud.layer.appendChild(this.tapPlay);
        this.tapPlay.focus({ preventScroll: true });
        return;
      }
      // refused even inside a tap: play it muted rather than not at all
      v.muted = true;
      this.diag.clipMuted = true;
      void v.play().catch(() => this.onClipEnd());
    });
    // a stalled clip must not leave you stuck: if time stops moving for 4 s while it should play, offer the tap
    let lastT = -1, still = 0;
    this.clipWatch = window.setInterval(() => {
      if (this.state !== 'clip' || this.tapPlay.isConnected) return;
      if (v.currentTime === lastT && !v.ended) {
        if (++still >= 8) { still = 0; this.ctx.hud.layer.appendChild(this.tapPlay); }
      } else still = 0;
      lastT = v.currentTime;
    }, 500);
  }

  private stopClip(): void {
    clearTimeout(this.clipTimer);
    clearInterval(this.clipWatch);
    const v = this.video;
    v.onended = null;
    try { v.pause(); } catch { /* none */ }
    v.muted = true;
    this.clipQuad.visible = false;
    this.tapPlay.remove();
  }

  /**
   * Her last frame: she holds the pose (the ended video stays on its last frame, so she is in the photo exactly as on
   * screen) while "Smile!" and a 3, 2, 1 count you in, then the photo. The shutter shoots at once meanwhile.
   */
  private onClipEnd(): void {
    clearInterval(this.clipWatch);
    if (this.state !== 'clip') return;
    this.diag.clipEnds++;
    this.tapPlay.remove();
    this.state = 'busy';
    this.armShutter(false);
    this.clipTimer = window.setTimeout(() => {
      if (this.state !== 'busy' || !this.countdown) return;
      if (this.look !== 'classic') { this.toLive(false); return; } // switched to the 3D bear meanwhile
      this.state = 'countdown';
      this.cheered = true; // the 3D bear's cheer is not part of Classic
      this.armShutter(true, 'Take the photo now');
      this.diag.clipCounts++;
      this.tuckPicker(true); // the look picker sits over her face: tucked away for the count
      void this.countdown
        .start(CLASSIC_COUNT_S, undefined, { lead: 'Smile!', leadS: CLASSIC_LEAD_S, note: '' })
        .then((go) => {
          if (this.state !== 'countdown') return;
          if (go) {
            this.diag.clipAutoShots++;
            void this.capture();
          } else this.toLive(false);
        });
    }, CLIP_HOLD_MS);
  }

  // ------------------------------------------------------------------ live / capture
  private toLive(hello: boolean): void {
    if (this.state === 'off') return;
    this.state = 'live';
    const hud = this.ctx.hud;
    if (!this.shutterBtn) this.shutterBtn = hud.shutter(() => this.onShutter(), 'Take a selfie with Cheer Bear', clipHold({
      // hold the shutter for a video: the chosen frame, filter and the title are baked into the clip
      can: () => this.state === 'live' && !this.review.open,
      options: () => {
        const frame = this.frame;
        return { overlay: (g, w, h) => drawFrameArt(g, w, h, { title: true, titleAt: 'edge', titleWidth: TITLE_W, frame }), filter: FILTER_CSS[this.filter].filter, tint: FILTER_CSS[this.filter].tint };
      },
      onStart: () => {
        this.state = 'recording';
        this.tuckPicker(true);
        this.ctx.hud.hint('');
        if (this.look === '3d') this.cheer(); // she hams it up for the camera
      },
      onDone: (blob) => {
        if (this.state !== 'recording') return;
        if (!blob) { this.ctx.hud.toast('Hold a little longer for a video', 2000); this.toLive(false); return; }
        this.diag.clips++;
        this.diag.lastClip = blob;
        this.state = 'review';
        this.review.show(blob);
      },
    }));
    this.shutterBtn.disabled = false;
    this.armShutter(false);
    if (this.shutterBtn.parentElement !== hud.centre) hud.centre.appendChild(this.shutterBtn);
    this.tuckPicker(false);
    // above the shutter, close together: the look picker, the frame / filter row (only while opened), then the
    // compact Frame | Filter toggle that opens it (polish-6)
    hud.above.append(this.picker.el, this.strip.el, this.strip.toggle);
    hud.left.appendChild(this.smileBtn);
    this.publishStripHeight();
    // Classic between takes: she stays on her last frame (the clip is paused there); the shutter plays it again
    this.clipQuad.visible = this.look === 'classic';
    this.setBearVisible(this.look === '3d');
    this.drawOverlay();
    hud.hint(this.faceFound ? '' : 'Look at the camera');
    const bear = this.ctx.bear;
    if (hello && bear && this.look === '3d') this.hello();
  }

  /** The 3D look's short hello: she waves and beams. */
  private hello(): void {
    const bear = this.ctx.bear;
    if (!bear || bear.object.parent !== this.bearHolder) return;
    bear.play('wave', { once: true, fade: 0.3 });
    this.setExpression('happy', 1.8);
    this.bounce = 1;
  }

  private setLook(l: Look, fromTap: boolean): void {
    const was = this.look;
    this.look = l;
    this.picker.set(l);
    if (this.state === 'off' || this.state === 'busy' || this.state === 'review') { this.drawOverlay(); return; }
    if (l === 'classic') {
      if (fromTap || was !== 'classic') this.playClip();
    } else {
      if (this.state === 'clip') this.stopClip();
      if (this.state === 'countdown') this.countdown?.cancel();
      this.tuckPicker(false);
      this.clipQuad.visible = false;
      this.state = 'live';
      this.armShutter(false);
      this.setBearVisible(l === '3d');
      if (l === '3d' && was !== '3d') this.hello();
      if (fromTap && l !== was) this.ctx.hud.toast(l === 'none' ? 'Just you this time' : 'Cheer Bear is back', 1400);
    }
    this.drawOverlay();
  }

  /** Countdowns and recording: the look picker and the chips (over her at phone size) fade out, inert until live. */
  private tuckPicker(on: boolean): void {
    if (on) this.strip.open(null);
    for (const el of [this.picker.el, this.strip.el, this.strip.toggle]) {
      el.classList.toggle('cbc-tuck', on);
      el.inert = on;
    }
  }

  /** The chosen filter's live look on the camera canvas (and the candy tint); `off` clears it on leaving. */
  private liveFilter(off = false): void {
    const css = FILTER_CSS[off ? 'natural' : this.filter];
    const cam = this.ctx.engine.canvas;
    if (cam) cam.style.filter = css.filter;
    this.tint.style.background = css.tint;
    this.tint.hidden = !css.tint;
  }

  /**
   * The height of what the Selfie stacks above the shutter (look picker, the open chip row, the Frame | Filter toggle,
   * in hud.above), as `--cbx-strip-h` on the experience root: that stack spans from `--cbx-bottom + 124px` up to
   * `--cbx-bottom + 124px + --cbx-strip-h`. Her speech bubble sits above it (hud.css). Removed on leaving.
   */
  private publishStripHeight(): void {
    if (this.state === 'off') return;
    let top = Infinity, bottom = -Infinity;
    for (const n of [this.picker.el, this.strip.el, this.strip.toggle]) {
      const r = n.getBoundingClientRect();
      if (!r.height) continue;
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
    }
    if (!(bottom > top)) return;
    this.ctx.container.style.setProperty('--cbx-strip-h', `${Math.round(bottom - top)}px`);
  }

  /** Test hook: pick a frame / filter as a chip tap would. */
  setStyle(frame: FrameStyle, filter: PhotoFilter): void {
    this.frame = frame;
    this.filter = filter;
    this.strip.set(frame, filter);
    this.drawOverlay();
    this.liveFilter();
  }

  private setBearVisible(on: boolean): void {
    this.bearHolder.visible = on;
    if (!on) this.setExpression('neutral');
  }

  private armShutter(on: boolean, aria = 'Take the photo now'): void {
    const b = this.shutterBtn;
    if (!b) return;
    b.classList.toggle('cbc-armed', on);
    b.setAttribute('aria-label', on ? aria : this.look === 'classic' ? 'Play Cheer Bear’s countdown again. Hold to record a video' : 'Take a selfie. Hold to record a video');
  }

  private onShutter(): void {
    if (this.state === 'countdown') {
      this.countdown?.now();
      return;
    }
    if (this.state === 'clip') {
      if (this.tapPlay.isConnected) this.playClip();
      return; // she is counting you down already
    }
    if (this.state !== 'live') return;
    if (this.look === 'classic') {
      this.playClip(); // another take: the clip again, inside this tap
      return;
    }
    this.startCountdown(COUNTDOWN_S);
  }

  private startCountdown(seconds: number): void {
    if (this.state !== 'live' || !this.countdown) return;
    this.state = 'countdown';
    this.cheered = false;
    this.ctx.hud.hint('');
    this.armShutter(true);
    void this.countdown
      .start(seconds, (left) => { if (!this.cheered && left <= 1.3) this.cheer(); })
      .then((go) => {
        if (this.state !== 'countdown') return;
        if (go) void this.capture();
        else this.toLive(false);
      });
  }

  private cheer(): void {
    this.cheered = true;
    const bear = this.ctx.bear;
    if (bear && this.look === '3d' && bear.object.parent === this.bearHolder) {
      bear.play('cheer', { once: true, fade: 0.2 });
      this.setExpression('happy', 2.5);
    }
  }

  private async capture(): Promise<void> {
    if (this.state !== 'countdown' && this.state !== 'busy') return;
    const classic = this.look === 'classic';
    this.state = 'busy';
    const b = this.shutterBtn;
    if (b) { b.disabled = true; b.classList.remove('cbc-armed'); }
    try {
      if (!classic && !this.cheered) {
        this.cheer();
        await new Promise((r) => setTimeout(r, 380)); // let her arms come up
      }
      if (this.state !== 'busy') return; // left the mode meanwhile
      flash(this.ctx.container, this.ctx.reducedMotion);
      shutterSound(this.ctx.reducedMotion);
      const img = await engineShot(this.ctx.engine);
      if (this.state !== 'busy') return;
      const frame = this.frame, filter = this.filter;
      // the saved picture has no top bar: the title cloud is part of the frame, tucked into its top edge (polish-6)
      const { blob } = await compose(img, (g, w, h) => drawFrameArt(g, w, h, { title: true, titleAt: 'edge', titleWidth: TITLE_W, frame, filter }));
      img.src = '';
      if (this.state !== 'busy') return;
      this.diag.shots++;
      this.diag.lastPhoto = blob;
      this.lastPhoto = blob;
      this.ctx.capture(blob);
      this.state = 'review';
      if (b) b.disabled = false;
      this.review.show(blob);
    } catch (e) {
      console.warn('[selfie] photo failed', e);
      this.ctx.hud.toast('That photo did not work. Try again?', 2200);
      this.toLive(false);
    }
  }

  // ------------------------------------------------------------------ smile to snap
  private toggleSmileSnap(): void {
    this.setSmileSnap(!this.smileSnap);
    this.ctx.hud.toast(this.smileSnap ? 'Smile to take the photo' : 'Smile to snap is off', 1600);
  }

  private setSmileSnap(on: boolean): void {
    this.smileSnap = on;
    this.smileArmed = !this.signals.smile; // a smile already on when you switch it on does not count
    this.smileBtn.setAttribute('aria-pressed', String(on));
    this.smileBtn.classList.toggle('on', on);
  }

  // ------------------------------------------------------------------ she mirrors you (3D look)
  private onCue(c: FaceCue): void {
    this.diag.reactions[c] = (this.diag.reactions[c] ?? 0) + 1;
    const bear = this.ctx.bear;
    if (!bear || this.look !== '3d' || !this.bearHolder.visible || bear.object.parent !== this.bearHolder) return;
    if (this.state !== 'live' && this.state !== 'countdown') return;
    switch (c) {
      case 'smile':
        if (!this.signals.mouthWide) { this.setExpression('happy'); this.bounce = 1; }
        break;
      case 'smileOff':
        if (this.diag.expression === 'happy') this.setExpression('neutral');
        break;
      case 'mouth':
        this.setExpression('surprised', 1.6);
        this.recoil = 1;
        break;
      case 'mouthOff':
        break; // the gasp fades by itself
      case 'wink':
        this.setExpression('wink', 0.9);
        break;
      case 'brows':
        this.setExpression('surprised', 1.1);
        this.bounce = 0.6;
        break;
    }
  }

  private setExpression(e: BearExpression, hold?: number): void {
    const bear = this.ctx.bear;
    this.diag.expression = e;
    if (!bear) return;
    bear.setExpression(e, hold ? { hold } : undefined);
    if (hold) {
      window.setTimeout(() => {
        if (this.diag.expression !== e) return;
        // back to beaming if you are still smiling, else neutral
        this.diag.expression = this.signals.smile && this.look === '3d' ? 'happy' : 'neutral';
        if (this.diag.expression === 'happy') bear.setExpression('happy');
      }, hold * 1000);
    }
  }

  /** Her head follows your head tilt (an additive turn on the head bone, after the clip and her look-at). */
  private tiltHead(): void {
    const h = this.headBone;
    if (!h || !h.parent || Math.abs(this.tilt) < 0.005) return;
    // the camera's view axis in the head's parent space; the bear restores this bone's clip pose every frame
    const parentQ = h.parent.getWorldQuaternion(this.q1);
    const axis = this.v1.set(0, 0, 1).applyQuaternion(this.cam.quaternion).applyQuaternion(parentQ.invert()).normalize();
    this.q2.setFromAxisAngle(axis, this.tilt * 0.75);
    h.quaternion.premultiply(this.q2);
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
    // drawn after the depth clear (restored when she goes back to the stages)
    o.traverse((m) => {
      if (!(m as THREE.Mesh).isMesh) return;
      m.userData.cbcOrder = m.renderOrder;
      m.renderOrder = OVERLAY_ORDER + m.renderOrder;
    });
    this.bearHolder.add(o);
    this.headBone = o.getObjectByName('mixamorigHead') ?? null;
    bear.play('idle', { fade: 0.2 });
  }

  private returnBear(): void {
    const bear = this.ctx.bear;
    if (!bear || bear.object.parent !== this.bearHolder) return;
    bear.object.traverse((m) => {
      if (typeof m.userData.cbcOrder === 'number') {
        m.renderOrder = m.userData.cbcOrder;
        delete m.userData.cbcOrder;
      }
    });
    this.bearHolder.remove(bear.object);
    this.headBone = null;
    this.tilt = 0;
  }

  /** On screen the title cloud sits just under the HUD's top bar (the saved photo: at the frame's top edge). */
  private measureTitle(): void {
    const c = this.ctx.container;
    const h = c.clientHeight || 1;
    const bar = c.querySelector('.cbx-top') as HTMLElement | null;
    const bottom = bar ? bar.getBoundingClientRect().bottom - c.getBoundingClientRect().top : 64;
    this.titleTop = Math.min(0.2, Math.max(0.06, (bottom + 6) / h));
    // the hint pill sits under the cloud in Selfie (hud.css), so "Look at the camera" never covers it (polish-6)
    const w = c.clientWidth || 1;
    const th = Math.min((w * TITLE_W * 349) / 662, h * 0.17); // frame-title.webp is 662 x 349
    c.style.setProperty('--cbc-title-h', `${Math.round(th + 4)}px`);
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
    // on screen the cloud sits just under the top bar (the saved picture has it at the frame's top edge)
    drawFrameArt(g, w, h, { title: true, titleTop: this.titleTop, titleWidth: TITLE_W, frame: this.frame, live: true });
  }
}

export function createMode(ctx: ModeContext): Mode {
  return new FaceMode(ctx);
}
export default createMode;
