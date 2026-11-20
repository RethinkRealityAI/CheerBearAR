// The 2D frame art laid over photos, drawn the same way on screen (an overlay canvas) and into the saved photo (and
// video clips), so what you frame is what you get. It is never mirrored: the selfie underneath is the mirror image,
// the art reads the right way. Round 5 (camera-5, ported from the Happi demo's live frames + filters, re-skinned):
//   rainbow  a flat six-stripe rainbow border with cloud puffs in the corners
//   clouds   a bank of white clouds along the bottom, corner clouds at the top, a few yellow stars
//   hearts   pink, red and white hearts scattered round the edges (never across the middle, where your face is)
//   clean    just the title cloud
// The title cloud is the old filter's art (Images/filter-peace.png, cut). Filters (natural, warm, candy, mono) are
// plain per-pixel colour maps, so the saved photo looks the same on every phone (no canvas `filter` needed); the live
// view uses a close CSS look (style-strip.ts FILTER_CSS). Everything is flat colour: no gradients (house rule).
import { loadImage } from './ui';

export type FrameStyle = 'rainbow' | 'clouds' | 'hearts' | 'clean';
export type PhotoFilter = 'natural' | 'warm' | 'candy' | 'mono';
export const FRAME_STYLES: Array<{ id: FrameStyle; label: string }> = [
  { id: 'rainbow', label: 'Rainbow' }, { id: 'clouds', label: 'Clouds' }, { id: 'hearts', label: 'Hearts' }, { id: 'clean', label: 'Clean' },
];
export const PHOTO_FILTERS: Array<{ id: PhotoFilter; label: string }> = [
  { id: 'natural', label: 'Natural' }, { id: 'warm', label: 'Warm' }, { id: 'candy', label: 'Candy' }, { id: 'mono', label: 'Mono' },
];

const TITLE = { url: '/img/capture/frame-title.webp', w: 662, h: 349 };
/** The rainbow, outside in (theme.css --cb-rainbow-1..6). */
const BANDS = ['#ff5a5f', '#ff9a3d', '#ffd84a', '#5fcf86', '#439bdd', '#9a6bff'];
const PINK = '#ff389b', PINK_SOFT = '#ffd6ea', RED = '#ff5a5f', WHITE = '#ffffff', CLOUD_SHADE = '#e3f1ff', STAR = '#ffd84a';

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
  /**
   * Where the title goes: top centre at `titleTop` (default; the live Selfie view, just under the HUD's top bar), 'edge':
   * top centre tucked into the frame's top edge (the saved Selfie photo and clip, polish-6: part of the frame), or the
   * bottom-left corner (3D Photo, 3D / AR shots: she and the frame are central).
   */
  titleAt?: 'top' | 'edge' | 'bottom-left';
  /** The decoration (default: clean, just the title). */
  frame?: FrameStyle;
  /** The colour look, run over the picture before the art (saved photos only; the live view uses CSS). */
  filter?: PhotoFilter;
  /** On screen while framing: a little lighter (fewer pieces), so the live view stays clear. */
  live?: boolean;
}

/** Per-pixel colour map for a filter (the saved photo). */
export function applyFilter(g: CanvasRenderingContext2D, w: number, h: number, f: PhotoFilter): void {
  if (f === 'natural') return;
  const d = g.getImageData(0, 0, w, h), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    let r = p[i], gg = p[i + 1], b = p[i + 2];
    if (f === 'warm') { r = r * 1.07 + 8; gg = gg * 1.02 + 3; b = b * 0.9; }
    else if (f === 'candy') { r = r * 0.88 + 255 * 0.12 + 6; gg = gg * 0.88 + 214 * 0.12; b = b * 0.88 + 234 * 0.12 + 6; }
    else if (f === 'mono') { const l = 0.3 * r + 0.59 * gg + 0.11 * b; r = gg = b = (l - 128) * 1.12 + 128; }
    p[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    p[i + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
    p[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  g.putImageData(d, 0, 0);
}

/** Small seeded random, so a frame draws the same every time (live view and the saved photo match). */
function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}

/** A flat cloud: overlapping circles on a flat base, with an optional pale underside. */
export function cloud(g: CanvasRenderingContext2D, x: number, y: number, w: number, shade = true): void {
  const h = w * 0.42;
  const puffs: Array<[number, number, number]> = [[0.18, 0.62, 0.2], [0.38, 0.4, 0.27], [0.62, 0.42, 0.24], [0.82, 0.62, 0.18]];
  if (shade) {
    g.fillStyle = CLOUD_SHADE;
    g.beginPath(); g.roundRect(x, y + h * 0.5, w, h * 0.5, h * 0.25); g.fill();
  }
  g.fillStyle = WHITE;
  for (const [u, v, r] of puffs) { g.beginPath(); g.arc(x + u * w, y + v * h, r * w, 0, Math.PI * 2); g.fill(); }
  g.beginPath(); g.roundRect(x, y + h * 0.45, w, h * 0.45, h * 0.22); g.fill();
}

/** A flat heart centred at (x, y), `s` wide. */
export function heart(g: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, col: string): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(s / 2, s / 2);
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(0, 0.75);
  g.bezierCurveTo(-0.15, 0.62, -1, 0.1, -1, -0.32);
  g.bezierCurveTo(-1, -0.78, -0.42, -0.98, 0, -0.55);
  g.bezierCurveTo(0.42, -0.98, 1, -0.78, 1, -0.32);
  g.bezierCurveTo(1, 0.1, 0.15, 0.62, 0, 0.75);
  g.fill();
  g.restore();
}

/** A four-point sparkle star. */
function sparkle(g: CanvasRenderingContext2D, x: number, y: number, r: number, col: string): void {
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x + r * 0.16, y - r * 0.16, x + r, y);
  g.quadraticCurveTo(x + r * 0.16, y + r * 0.16, x, y + r);
  g.quadraticCurveTo(x - r * 0.16, y + r * 0.16, x - r, y);
  g.quadraticCurveTo(x - r * 0.16, y - r * 0.16, x, y - r);
  g.fill();
}

/** The rainbow frame's band width (chip previews: chunkier). */
function bandW(m: number, live: boolean): number {
  return Math.max(2, Math.round(m * (live ? 0.0085 : 0.01)), m < 200 ? Math.round(m * 0.022) : 0);
}
/** Where the rainbow frame's inside starts (the six bands and the white line). */
function edgeInset(m: number, live: boolean): number {
  const s = bandW(m, live);
  return BANDS.length * s + Math.max(1, Math.round(s * 0.6));
}

/** Rainbow: six flat stripes round the edge, a white inner line, cloud puffs over two corners. */
function rainbowFrame(g: CanvasRenderingContext2D, w: number, h: number, live: boolean): void {
  const m = Math.min(w, h);
  const s = bandW(m, live);
  BANDS.forEach((c, i) => {
    const o = i * s;
    g.fillStyle = c;
    g.fillRect(o, o, w - 2 * o, s); g.fillRect(o, h - o - s, w - 2 * o, s);
    g.fillRect(o, o, s, h - 2 * o); g.fillRect(w - o - s, o, s, h - 2 * o);
  });
  const o = BANDS.length * s;
  g.fillStyle = WHITE;
  const l = Math.max(1, Math.round(s * 0.6));
  g.fillRect(o, o, w - 2 * o, l); g.fillRect(o, h - o - l, w - 2 * o, l); g.fillRect(o, o, l, h - 2 * o); g.fillRect(w - o - l, o, l, h - 2 * o);
  // the saved picture: a cloud over the bottom-left corner and two sparkles (left off on screen, where the HUD's
  // corner buttons sit)
  if (!live) {
    cloud(g, -m * 0.05, h - m * 0.17, m * 0.36);
    sparkle(g, w - m * 0.1, h - m * 0.1, m * 0.03, STAR);
    sparkle(g, w - m * 0.1, m * 0.1, m * 0.025, STAR);
  }
}

/** Clouds: a bank of white clouds along the bottom, two corner clouds at the top, a few stars. */
function cloudsFrame(g: CanvasRenderingContext2D, w: number, h: number, live: boolean): void {
  const m = Math.min(w, h);
  const R = rng(7);
  const n = Math.ceil(w / (m * 0.3)) + 1;
  for (let i = 0; i < n; i++) {
    const cw = m * (0.36 + R() * 0.14);
    cloud(g, i * m * 0.3 - m * 0.1, h - cw * 0.34 - R() * m * 0.025, cw, false);
  }
  g.fillStyle = WHITE;
  g.fillRect(0, h - m * 0.05, w, m * 0.05);
  cloud(g, -m * 0.08, m * 0.04, m * 0.38);
  cloud(g, w - m * 0.32, m * 0.1, m * 0.4);
  const stars: Array<[number, number, number]> = [[0.08, 0.32, 0.03], [0.92, 0.36, 0.026], [0.86, 0.62, 0.02], [0.12, 0.66, 0.022], [0.5, 0.94, 0.02]];
  stars.forEach(([u, v, r], i) => { if (!live || i % 2 === 0) sparkle(g, u * w, v * h, r * m, STAR); });
}

/** Hearts: scattered round the edges, never across the middle of the picture (where your face is). */
function heartsFrame(g: CanvasRenderingContext2D, w: number, h: number, live: boolean): void {
  const m = Math.min(w, h);
  const R = rng(19);
  const cols = [PINK, RED, WHITE, PINK_SOFT, PINK];
  const want = live ? 22 : 34;
  let placed = 0;
  for (let tries = 0; placed < want && tries < 400; tries++) {
    const x = R() * w, y = R() * h;
    // a band round the edge: within 17 % of the short side from any edge
    const edge = Math.min(x, y, w - x, h - y);
    if (edge > m * 0.17) continue;
    const s = m * (0.05 + R() * 0.07) * (edge < m * 0.06 ? 1.15 : 0.85);
    heart(g, x, y, s, (R() - 0.5) * 0.9, cols[placed % cols.length]);
    placed++;
  }
  // a flat pink edge line ties them together
  const b = Math.max(2, Math.round(m * 0.012));
  g.fillStyle = PINK;
  g.fillRect(0, 0, w, b); g.fillRect(0, h - b, w, b); g.fillRect(0, 0, b, h); g.fillRect(w - b, 0, b, h);
}

export function drawFrameArt(g: CanvasRenderingContext2D, w: number, h: number, s: FrameSpec): void {
  if (s.filter) applyFilter(g, w, h, s.filter);
  const frame = s.frame ?? 'clean';
  const live = !!s.live;
  if (frame === 'rainbow') rainbowFrame(g, w, h, live);
  else if (frame === 'clouds') cloudsFrame(g, w, h, live);
  else if (frame === 'hearts') heartsFrame(g, w, h, live);
  const title = loaded;
  if (!s.title || !title) return;
  let tw = w * (s.titleWidth ?? 0.6);
  let th = tw * (TITLE.h / TITLE.w);
  if (th > h * 0.17) { th = h * 0.17; tw = th * (TITLE.w / TITLE.h); }
  if (s.titleAt === 'bottom-left') {
    const m = Math.min(w, h) * (frame === 'rainbow' ? 0.08 : 0.035);
    g.drawImage(title, m, h - th - m, tw, th);
  } else if (s.titleAt === 'edge') {
    // part of the frame: just inside the rainbow's bands, among the top clouds, or a small margin
    const m = Math.min(w, h);
    const y = frame === 'rainbow' ? edgeInset(m, live) + m * 0.012 : frame === 'clouds' ? m * 0.03 : m * 0.035;
    g.drawImage(title, (w - tw) / 2, y, tw, th);
  } else g.drawImage(title, (w - tw) / 2, h * (s.titleTop ?? 0.02), tw, th);
}
