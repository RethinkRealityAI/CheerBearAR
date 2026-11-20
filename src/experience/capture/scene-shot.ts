// The capture button in 3D and AR (round 5, camera-5, as Happi has it): a round shutter at the top of chrome-5's
// Actions + Games stack, bottom right over the talk button (hud.dockShutter). Tap = a photo of the view as you see it
// (the title cloud bottom left, like 3D Photo), hold = a video clip (recorder.ts), then the review sheet with the
// Frame / Filter chips. It follows the dock's hide rules (orb busy, games, AR placing, mode covers): hiding the dock
// mid-clip stops the clip (hud.ts).
//   3D: the showcase's own canvas, grabbed straight after it is drawn (recorder.grab()).
//   AR: the engine's screenshot (camera + 3D, like 3D Photo).
import { compose, engineShot, type OverlayFn } from './compose';
import { flash } from './countdown';
import { FRAME_STYLES, PHOTO_FILTERS, drawFrameArt, loadFrameArt, type FrameSpec, type FrameStyle, type PhotoFilter } from './frame-art';
import { clipHold, recorder } from './recorder';
import { ReviewSheet } from './review';
import { FILTER_CSS } from './style-strip';
import type { EngineView } from '../types';

export interface SceneShotHost {
  /** The experience root (the flash and the review sheet go in it). */
  container: HTMLElement;
  reduced: boolean;
  /** Hand a finished photo to the app (ModeContext.capture). */
  capture(blob: Blob): void;
  /** The HUD's shutter factory (tap / hold). */
  shutter(onClick: () => void, aria: string, hold: { start(): boolean; stop(): void }): HTMLButtonElement;
  /** Where the picture comes from. */
  source: 'grab' | EngineView;
  /** May it shoot now (placed, no game, not mid-moment...)? */
  can(): boolean;
  /** File name stem and review title. */
  name: string;
  title: string;
  /** A clip started (the mode can cheer). */
  onRecord?(): void;
  /** A short note (the HUD toast). */
  toast(text: string): void;
}

export class SceneShot {
  readonly el: HTMLButtonElement;
  private review: ReviewSheet;
  private shot: HTMLCanvasElement | HTMLImageElement | null = null;
  private frame: FrameStyle = 'clean';
  private filter: PhotoFilter = 'natural';
  private busy = false;
  private live = false;
  /** Test hooks. */
  readonly diag = { shots: 0, clips: 0, restyles: 0, lastPhoto: null as Blob | null, lastClip: null as Blob | null, failed: 0 };

  constructor(private h: SceneShotHost) {
    const self = this;
    this.review = new ReviewSheet({
      container: h.container,
      name: h.name,
      title: h.title,
      share: { title: 'Cheer Bear and me', text: 'A photo with Cheer Bear!' },
      onRetake: () => this.dropShot(),
      styles: {
        frames: FRAME_STYLES, filters: PHOTO_FILTERS,
        get frame() { return self.frame; },
        get filter() { return self.filter; },
        restyle: async (frame, filter) => {
          if (!this.shot) throw new Error('no shot');
          const spec = this.spec(frame as FrameStyle, filter as PhotoFilter);
          return (await compose(this.shot, (g, w, hh) => drawFrameArt(g, w, hh, spec))).blob;
        },
        onChange: (blob, frame, filter) => {
          this.frame = frame as FrameStyle;
          this.filter = filter as PhotoFilter;
          this.diag.lastPhoto = blob;
          this.diag.restyles++;
        },
      },
    });
    this.el = h.shutter(() => void this.photo(), 'Take a photo: tap for a photo, hold for a video', clipHold({
      can: () => this.live && !this.busy && !this.review.open && h.can(),
      options: () => {
        const spec = { ...this.spec(this.frame, this.filter), filter: undefined };
        const overlay: OverlayFn = (g, w, hh) => drawFrameArt(g, w, hh, spec);
        return { overlay, filter: FILTER_CSS[this.filter].filter, tint: FILTER_CSS[this.filter].tint };
      },
      onStart: () => h.onRecord?.(),
      onDone: (blob) => {
        if (!this.live) return; // the mode was left mid-clip
        if (!blob) { h.toast('Hold a little longer for a video'); return; }
        this.diag.clips++;
        this.diag.lastClip = blob;
        this.review.show(blob);
      },
    }));
    this.el.classList.add('is-shot');
    void loadFrameArt();
  }

  get open(): boolean {
    return this.review.open;
  }

  /** The mode came in / went out (out: the review closes and a running clip is dropped). */
  setLive(on: boolean): void {
    this.live = on;
    if (on) return;
    if (recorder.recording) void recorder.stop();
    this.review.close();
    this.dropShot();
  }

  private spec(frame: FrameStyle, filter: PhotoFilter): FrameSpec {
    return { title: true, titleWidth: 0.34, titleAt: 'bottom-left', frame, filter };
  }

  private async photo(): Promise<void> {
    if (!this.live || this.busy || this.review.open || recorder.recording || !this.h.can()) return;
    this.busy = true;
    try {
      flash(this.h.container, this.h.reduced);
      const img = this.h.source === 'grab' ? await recorder.grab() : await engineShot(this.h.source);
      if (!this.live) return;
      const { blob } = await compose(img, (g, w, hh) => drawFrameArt(g, w, hh, this.spec(this.frame, this.filter)));
      if (!this.live) return;
      this.dropShot();
      this.shot = img; // kept while the review is open: the Frame / Filter chips recompose from it
      this.diag.shots++;
      this.diag.lastPhoto = blob;
      this.h.capture(blob);
      this.review.show(blob);
    } catch (e) {
      console.warn('[scene shot] failed', e);
      this.diag.failed++;
    } finally {
      this.busy = false;
    }
  }

  private dropShot(): void {
    if (this.shot instanceof HTMLCanvasElement) this.shot.width = this.shot.height = 0;
    else if (this.shot) this.shot.src = '';
    this.shot = null;
  }
}
