// Video clips: "tap for a photo, hold for a video" on the shutter (Dapo, round 5, ported from the Happi demo).
// The engine hands every finished frame to `recorder.frame(canvas)` straight after drawing it (the XR pipeline's
// onRender), so the WebGL canvas is still valid without preserveDrawingBuffer. While a clip runs, each frame is copied
// onto a 2D canvas (with the live filter and the overlay art, drawn once into a cache), which a MediaRecorder encodes.
//
// Sound: the experience's Web Audio output (Cheer Bear's voice on the demo / lip-sync path, game and shutter sounds,
// the jukebox) is mirrored into the clip. Every connection to the shared AudioContext's destination is also connected
// to a silent-by-default tap gain (a tiny patch of AudioNode.connect, installed when this module loads, before any
// audio exists); while recording, the tap feeds a MediaStreamDestination whose track joins the canvas stream. Media
// elements that play outside Web Audio (the Classic selfie clip, a WebRTC call's remote audio element) are not in the
// clip. `?noclipaudio` turns the sound off.
//
// Format: the first type MediaRecorder supports from TYPES: MP4 (H.264) first (iOS Safari 14.5+ only records MP4,
// and an MP4 saves to the iPhone photo library), then WebM (Chrome / Android, Firefox). The file extension follows the
// blob's type (clipExt). No MediaRecorder or no canvas.captureStream (old iOS): `supported` is false and holding the
// shutter just takes a photo.
import type { OverlayFn } from './compose';

export const CLIP_MAX_S = 30;
const LONG_EDGE = 1280;
const TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4',
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
];

export interface ClipOptions {
  /** Brand art over the video (drawn once at the clip's size). */
  overlay?: OverlayFn;
  /** 2D canvas filter string (the live look), e.g. 'grayscale(1)'. */
  filter?: string;
  /** A flat tint over the picture (candy), e.g. 'rgba(255,214,234,0.16)'. */
  tint?: string;
  /** Called every ~100 ms with seconds recorded. */
  onTick?: (s: number) => void;
  /** The clip stopped by itself (time limit): the blob, or null when nothing usable was recorded. */
  onAutoStop?: (blob: Blob | null) => void;
}

// ---------------------------------------------------------------- the audio tap
type Tap = { ctx: AudioContext; gain: GainNode; dest: MediaStreamAudioDestinationNode | null };
let tap: Tap | null = null;
const audioOff = typeof location !== 'undefined' && /[?&]noclipaudio\b/.test(location.search);

function tapFor(ctx: AudioContext): GainNode | null {
  if (tap && tap.ctx === ctx) return tap.gain;
  if (tap) return null; // one context only (the app has exactly one: src/audio/context.ts)
  try {
    const gain = ctx.createGain();
    tap = { ctx, gain, dest: null };
    return gain;
  } catch {
    return null;
  }
}

if (!audioOff && typeof AudioNode !== 'undefined' && typeof AudioContext !== 'undefined') {
  const P = AudioNode.prototype as AudioNode & { __cbxTap?: boolean };
  if (!P.__cbxTap) {
    P.__cbxTap = true;
    const connect = P.connect as (this: AudioNode, ...a: unknown[]) => unknown;
    const disconnect = P.disconnect as (this: AudioNode, ...a: unknown[]) => unknown;
    const isOut = (n: unknown): n is AudioDestinationNode =>
      typeof AudioDestinationNode !== 'undefined' && n instanceof AudioDestinationNode && n.context instanceof AudioContext;
    P.connect = function (this: AudioNode, ...a: unknown[]) {
      const r = connect.apply(this, a);
      if (isOut(a[0])) {
        const g = tapFor(a[0].context as AudioContext);
        if (g && this !== g) { try { connect.call(this, g, a[1] ?? 0); } catch { /* mismatched channels: skip */ } }
      }
      return r;
    } as AudioNode['connect'];
    P.disconnect = function (this: AudioNode, ...a: unknown[]) {
      const r = disconnect.apply(this, a);
      if (isOut(a[0]) && tap && tap.ctx === a[0].context && this !== tap.gain) { try { disconnect.call(this, tap.gain); } catch { /* not tapped */ } }
      return r;
    } as AudioNode['disconnect'];
  }
}

/** The experience's sound as a track for the clip (null when there is no running Web Audio). */
function audioTrack(): MediaStreamTrack | null {
  if (audioOff || !tap || tap.ctx.state !== 'running') return null;
  try {
    tap.dest ??= tap.ctx.createMediaStreamDestination();
    tap.gain.connect(tap.dest);
    return tap.dest.stream.getAudioTracks()[0] ?? null;
  } catch {
    return null;
  }
}
function audioDone(): void {
  if (!tap?.dest) return;
  try { tap.gain.disconnect(tap.dest); } catch { /* not connected */ }
}

// ---------------------------------------------------------------- the recorder
class Recorder {
  private c: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  private cache: HTMLCanvasElement | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private o: ClipOptions | null = null;
  private t0 = 0;
  private tickT = 0;
  private done: ((b: Blob | null) => void) | null = null;
  private type = '';
  /** Test hooks. */
  readonly diag = { clips: 0, frames: 0, lastType: '', lastBytes: 0, audio: false, failed: 0 };

  get supported(): boolean {
    return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function' && !!this.pickType();
  }
  get recording(): boolean {
    return !!this.o;
  }
  get seconds(): number {
    return this.o && this.t0 ? (performance.now() - this.t0) / 1000 : 0;
  }

  private pickType(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    for (const t of TYPES) {
      try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* keep looking */ }
    }
    return '';
  }

  /** Start a clip; frames arrive through frame(). Returns false when this browser can't record. */
  start(o: ClipOptions): boolean {
    if (this.o || !this.supported) return false;
    this.o = o;
    this.chunks = [];
    this.t0 = 0;
    return true;
  }

  /** Stop and get the clip (null when it was too short or failed). */
  stop(): Promise<Blob | null> {
    if (!this.o) return Promise.resolve(null);
    return new Promise((resolve) => {
      const rec = this.rec;
      this.o = null;
      if (!rec || rec.state === 'inactive') { this.reset(); resolve(null); return; }
      this.done = resolve;
      try { rec.requestData(); } catch { /* some browsers */ }
      try { rec.stop(); } catch { this.reset(); resolve(null); }
    });
  }

  /** One copy of the next finished frame (the 3D view's photo: what you see, read while the WebGL canvas is valid). */
  grab(timeoutMs = 1500): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      const t = window.setTimeout(() => { this.grabs = this.grabs.filter((f) => f !== got); reject(new Error('no frame')); }, timeoutMs);
      const got = (c: HTMLCanvasElement) => { clearTimeout(t); resolve(c); };
      this.grabs.push(got);
    });
  }
  private grabs: Array<(c: HTMLCanvasElement) => void> = [];

  /** Called by the renderer right after each frame is drawn. Cheap when idle. */
  frame(src: HTMLCanvasElement): void {
    if (this.grabs.length && src.width && src.height) {
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      c.getContext('2d')?.drawImage(src, 0, 0);
      const gs = this.grabs; this.grabs = [];
      for (const f of gs) f(c);
    }
    const o = this.o;
    if (!o || !src.width || !src.height) return;
    if (!this.rec) this.begin(src, o);
    const g = this.g, c = this.c;
    if (!g || !c) return;
    if (o.filter) g.filter = o.filter;
    g.drawImage(src, 0, 0, c.width, c.height);
    if (o.filter) g.filter = 'none';
    if (o.tint) { g.fillStyle = o.tint; g.fillRect(0, 0, c.width, c.height); }
    if (this.cache) g.drawImage(this.cache, 0, 0);
    this.diag.frames++;
    const now = performance.now();
    if (now - this.tickT > 100) { this.tickT = now; o.onTick?.(this.seconds); }
    if (this.seconds >= CLIP_MAX_S) {
      const cb = o.onAutoStop;
      void this.stop().then((b) => cb?.(b));
    }
  }

  private begin(src: HTMLCanvasElement, o: ClipOptions): void {
    const k = Math.min(1, LONG_EDGE / Math.max(src.width, src.height));
    const w = even(src.width * k), h = even(src.height * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    this.c = c;
    this.g = c.getContext('2d');
    if (o.overlay) {
      const cache = document.createElement('canvas');
      cache.width = w; cache.height = h;
      const cg = cache.getContext('2d');
      if (cg) { try { o.overlay(cg, w, h); } catch (e) { console.warn('[recorder] overlay failed', e); } }
      this.cache = cache;
    }
    this.type = this.pickType();
    try {
      const stream = c.captureStream(30);
      const at = audioTrack();
      if (at) stream.addTrack(at);
      this.diag.audio = !!at;
      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(stream, { mimeType: this.type, videoBitsPerSecond: 6_000_000 });
      } catch {
        // a type with audio codecs refused for this stream: let the browser choose
        rec = new MediaRecorder(stream);
        this.type = rec.mimeType || this.type;
      }
      rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      rec.onstop = () => {
        const type = (rec.mimeType || this.type).split(';')[0] || 'video/webm';
        const blob = this.chunks.length ? new Blob(this.chunks, { type }) : null;
        const cb = this.done;
        this.reset();
        const ok = blob && blob.size > 2000 ? blob : null;
        if (ok) { this.diag.clips++; this.diag.lastType = type; this.diag.lastBytes = ok.size; }
        cb?.(ok);
      };
      rec.onerror = () => { this.diag.failed++; };
      rec.start(250);
      this.rec = rec;
      this.t0 = performance.now();
    } catch (e) {
      console.warn('[recorder] could not start', e);
      this.diag.failed++;
      const cb = o.onAutoStop;
      this.o = null;
      this.reset();
      cb?.(null);
    }
  }

  private reset(): void {
    audioDone();
    this.rec = null;
    this.done = null;
    this.chunks = [];
    if (this.c) this.c.width = this.c.height = 0;
    if (this.cache) this.cache.width = this.cache.height = 0;
    this.c = this.cache = null;
    this.g = null;
    this.t0 = 0;
  }
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/** File extension for a clip blob. */
export function clipExt(blob: Blob): string {
  return /mp4/.test(blob.type) ? 'mp4' : 'webm';
}

export const recorder = new Recorder();

/**
 * A shutter's press-and-hold video, wired to a view: `can()` says whether it may record now, `options()` gives the
 * clip's overlay and look at the moment recording starts, `onStart` / `onDone` let the view tuck its UI and show
 * the review (blob null = too short or failed).
 */
export function clipHold(v: {
  can(): boolean;
  options?(): Omit<ClipOptions, 'onAutoStop' | 'onTick'>;
  onStart?(): void;
  onDone(blob: Blob | null): void;
}): { start(): boolean; stop(): void } {
  let live = false;
  const finish = (b: Blob | null) => { if (!live) return; live = false; v.onDone(b); };
  return {
    start() {
      if (!v.can() || !recorder.supported) return false;
      if (!recorder.start({ ...(v.options?.() ?? {}), onAutoStop: finish })) return false;
      live = true;
      v.onStart?.();
      return true;
    },
    stop() {
      if (!live) return;
      void recorder.stop().then(finish);
    },
  };
}
