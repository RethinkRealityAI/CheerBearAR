// The 2D frame art laid over photos, drawn the same way on screen (an overlay canvas) and into the saved photo, so
// what you frame is what you get. Art is the title cloud cut from the old filter's overlay (Images/filter-peace.png).
// It is never mirrored: the selfie underneath is the mirror image, the lettering reads the right way. (Round 2: the
// peace-sign bear art is gone; Classic now shows the wink clip itself, keyed, in the photo.)
import { loadImage } from './ui';

const TITLE = { url: '/img/capture/frame-title.webp', w: 662, h: 349 };

let art: Promise<HTMLImageElement | null> | null = null;
let loaded: HTMLImageElement | null = null;

export function loadFrameArt(): Promise<void> {
  if (!art) art = loadImage(TITLE.url).then((title) => (loaded = title));
  return art.then(() => undefined);
}

export interface FrameSpec {
  /** Draw the title cloud. */
  title: boolean;
  /** Title width as a share of the picture width. */
  titleWidth?: number;
  /** Title top as a share of the picture height (below the HUD's top bar on screen). */
  titleTop?: number;
  /** Where the title goes: top centre (default), or the bottom-left corner (3D Photo: she and the frame are central). */
  titleAt?: 'top' | 'bottom-left';
}

export function drawFrameArt(g: CanvasRenderingContext2D, w: number, h: number, s: FrameSpec): void {
  const title = loaded;
  if (!s.title || !title) return;
  let tw = w * (s.titleWidth ?? 0.6);
  let th = tw * (TITLE.h / TITLE.w);
  if (th > h * 0.17) { th = h * 0.17; tw = th * (TITLE.w / TITLE.h); }
  if (s.titleAt === 'bottom-left') {
    const m = Math.min(w, h) * 0.035;
    g.drawImage(title, m, h - th - m, tw, th);
  } else g.drawImage(title, (w - tw) / 2, h * (s.titleTop ?? 0.02), tw, th);
}
