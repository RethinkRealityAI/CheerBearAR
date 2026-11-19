// The 2D frame art laid over photos, drawn the same way on screen (an overlay canvas) and into the saved photo, so
// what you frame is what you get. Art is the old filter's own overlay (Images/filter-peace.png, 1080x1920) cut into
// two pieces: the title cloud (top) and the peace-sign Cheer Bear (bottom left). It is never mirrored: the selfie
// underneath is the mirror image, the lettering reads the right way.
import { loadImage } from './ui';

const TITLE = { url: '/img/capture/frame-title.webp', w: 662, h: 349 };
const PEACE = { url: '/img/capture/frame-peace.webp', w: 706, h: 900 };

let art: Promise<{ title: HTMLImageElement | null; peace: HTMLImageElement | null }> | null = null;
let loaded: { title: HTMLImageElement | null; peace: HTMLImageElement | null } = { title: null, peace: null };

export function loadFrameArt(): Promise<void> {
  if (!art) {
    art = Promise.all([loadImage(TITLE.url), loadImage(PEACE.url)]).then(([title, peace]) => (loaded = { title, peace }));
  }
  return art.then(() => undefined);
}

export interface FrameSpec {
  /** Draw the title cloud. */
  title: boolean;
  /** Title width as a share of the picture width. */
  titleWidth?: number;
  /** Title top as a share of the picture height (below the HUD's top bar on screen). */
  titleTop?: number;
  /** The classic peace-sign Cheer Bear at the bottom left. */
  peace?: boolean;
}

export function drawFrameArt(g: CanvasRenderingContext2D, w: number, h: number, s: FrameSpec): void {
  const { title, peace } = loaded;
  if (s.peace && peace) {
    // same place and size as the old 1080x1920 overlay (65 % of the width, anchored bottom left), never over half height
    let pw = w * (PEACE.w / 1080);
    let ph = pw * (PEACE.h / PEACE.w);
    if (ph > h * 0.5) { ph = h * 0.5; pw = ph * (PEACE.w / PEACE.h); }
    g.drawImage(peace, 0, h - ph, pw, ph);
  }
  if (s.title && title) {
    let tw = w * (s.titleWidth ?? 0.6);
    let th = tw * (TITLE.h / TITLE.w);
    if (th > h * 0.17) { th = h * 0.17; tw = th * (TITLE.w / TITLE.h); }
    g.drawImage(title, (w - tw) / 2, h * (s.titleTop ?? 0.02), tw, th);
  }
}
