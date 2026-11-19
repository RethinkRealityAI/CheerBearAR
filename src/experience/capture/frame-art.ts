// The 2D frame art laid over photos, drawn the same way on screen (an overlay canvas) and into the saved photo, so
// what you frame is what you get. Never mirrored: the selfie underneath is the mirror image, the art reads the right
// way. Happi's frames (round 3):
//   blossom  cherry branches in flower across the top corners, a few falling petals, the lockup bottom right
//   parade   a navy border with the happi coat's white checker trim, the lockup on a white tab bottom right
//   clean    just the lockup, small, bottom right
// The lockup is the splash's: the Japan Parade & Street Fair wordmark over the Happi logo. Filters (natural, warm,
// sakura, mono) are plain per-pixel colour maps, so they work the same on every phone (no canvas `filter`).
import { loadImage } from './ui';

export type FrameStyle = 'blossom' | 'parade' | 'clean';
export type PhotoFilter = 'natural' | 'warm' | 'sakura' | 'mono';
export const FRAME_STYLES: Array<{ id: FrameStyle; label: string }> = [
  { id: 'blossom', label: 'Blossom' }, { id: 'parade', label: 'Parade' }, { id: 'clean', label: 'Clean' },
];
export const PHOTO_FILTERS: Array<{ id: PhotoFilter; label: string }> = [
  { id: 'natural', label: 'Natural' }, { id: 'warm', label: 'Warm' }, { id: 'sakura', label: 'Sakura' }, { id: 'mono', label: 'Mono' },
];

const WM = { url: '/img/parade-wordmark.webp', w: 600, h: 127 };
const LOGO = { url: '/img/happi-logo.webp', w: 769, h: 309 };

let art: Promise<void> | null = null;
let wm: HTMLImageElement | null = null;
let logo: HTMLImageElement | null = null;

export function loadFrameArt(): Promise<void> {
  if (!art) art = Promise.all([loadImage(WM.url), loadImage(LOGO.url)]).then(([a, b]) => { wm = a; logo = b; });
  return art;
}

export interface FrameSpec {
  /** Draw the lockup. */
  title: boolean;
  /** Lockup width as a share of the picture width. */
  titleWidth?: number;
  /** (kept for callers; the lockup now sits in a bottom corner) */
  titleTop?: number;
  /** Which bottom corner the lockup goes in (default right; 3D Photo keeps it left). */
  titleAt?: 'top' | 'bottom-left' | 'bottom-right';
  frame?: FrameStyle;
  filter?: PhotoFilter;
  /** On screen while framing: only the decoration that never covers you (no lockup, lighter blossom). */
  live?: boolean;
}

/** Wordmark over logo, `w` wide, top-left at (x, y). Returns its height. */
export function drawLockup(g: CanvasRenderingContext2D, x: number, y: number, w: number): number {
  if (!wm || !logo) return 0;
  const wh = w * 0.84 * (WM.h / WM.w), lh = w * (LOGO.h / LOGO.w);
  g.drawImage(wm, x + w * 0.08, y, w * 0.84, wh);
  g.drawImage(logo, x, y + wh + w * 0.02, w, lh);
  return wh + w * 0.02 + lh;
}
function lockupHeight(w: number): number {
  return w * 0.84 * (WM.h / WM.w) + w * 0.02 + w * (LOGO.h / LOGO.w);
}

export function applyFilter(g: CanvasRenderingContext2D, w: number, h: number, f: PhotoFilter): void {
  if (f === 'natural') return;
  const d = g.getImageData(0, 0, w, h), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    let r = p[i], gg = p[i + 1], b = p[i + 2];
    if (f === 'warm') { r = r * 1.07 + 8; gg = gg * 1.02 + 3; b = b * 0.9; }
    else if (f === 'sakura') { r = r * 0.9 + 255 * 0.1 + 6; gg = gg * 0.9 + 183 * 0.1; b = b * 0.9 + 201 * 0.1 + 4; }
    else if (f === 'mono') { const l = 0.3 * r + 0.59 * gg + 0.11 * b; r = gg = b = (l - 128) * 1.12 + 128; }
    p[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    p[i + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
    p[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  g.putImageData(d, 0, 0);
}

function blossom(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, col: string): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = col;
  for (let i = 0; i < 5; i++) {
    g.save();
    g.rotate((i * Math.PI * 2) / 5);
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(-r * 0.55, -r * 0.35, -r * 0.45, -r * 1.0, -r * 0.12, -r * 1.0);
    g.lineTo(0, -r * 0.82);
    g.lineTo(r * 0.12, -r * 1.0);
    g.bezierCurveTo(r * 0.45, -r * 1.0, r * 0.55, -r * 0.35, 0, 0);
    g.fill();
    g.restore();
  }
  g.fillStyle = '#d94f7a';
  g.beginPath(); g.arc(0, 0, r * 0.2, 0, Math.PI * 2); g.fill();
  g.restore();
}

/** A cherry branch from a corner: a dark twig with blossoms and buds. `dir` 1 = from the left edge, -1 = right. */
function branch(g: CanvasRenderingContext2D, w: number, h: number, dir: 1 | -1, k: number, live: boolean, ref = Math.min(w, h)): void {
  const s = ref * k;
  const x0 = dir > 0 ? -s * 0.05 : w + s * 0.05, y0 = s * 0.12;
  const X = (u: number) => x0 + dir * u * s;
  g.strokeStyle = '#4a2f27';
  g.lineCap = 'round';
  g.lineWidth = s * 0.035;
  g.beginPath(); g.moveTo(X(0), y0); g.quadraticCurveTo(X(0.35), y0 + s * 0.02, X(0.75), y0 + s * 0.16); g.stroke();
  g.lineWidth = s * 0.02;
  g.beginPath(); g.moveTo(X(0.35), y0 + s * 0.03); g.quadraticCurveTo(X(0.45), y0 + s * 0.2, X(0.42), y0 + s * 0.32); g.stroke();
  g.beginPath(); g.moveTo(X(0.6), y0 + s * 0.1); g.quadraticCurveTo(X(0.72), y0 + s * 0.02, X(0.9), y0 + s * 0.02); g.stroke();
  const pts: Array<[number, number, number, string]> = [
    [0.12, 0.0, 0.075, '#ffb7c9'], [0.24, 0.05, 0.06, '#ffffff'], [0.38, 0.0, 0.08, '#ff94b0'], [0.44, 0.2, 0.065, '#ffb7c9'],
    [0.42, 0.33, 0.05, '#ffffff'], [0.56, 0.1, 0.07, '#ffffff'], [0.7, 0.13, 0.075, '#ffb7c9'], [0.78, 0.03, 0.055, '#ff94b0'], [0.9, 0.02, 0.05, '#ffffff'],
  ];
  pts.forEach(([u, v, r, c], i) => {
    if (live && i % 3 === 2) return;
    blossom(g, X(u), y0 + v * s, r * s, i * 0.7, c);
  });
  // falling petals
  g.fillStyle = '#ffb7c9';
  for (let i = 0; i < (live ? 3 : 6); i++) {
    const px = X(0.2 + i * 0.13), py = y0 + s * (0.42 + (i % 3) * 0.12);
    g.beginPath(); g.ellipse(px, py, s * 0.022, s * 0.013, i * 0.9, 0, Math.PI * 2); g.fill();
  }
}

/** A cherry branch from the top-left (dir 1) or top-right (-1) corner, `k * ref` px long (the splash uses it too). */
export function cherryBranch(g: CanvasRenderingContext2D, w: number, h: number, dir: 1 | -1, k: number, ref: number): void {
  branch(g, w, h, dir, k, false, ref);
}

function checkerBorder(g: CanvasRenderingContext2D, w: number, h: number): void {
  const b = Math.round(Math.min(w, h) * 0.035), c = Math.max(4, Math.round(b / 2));
  g.fillStyle = '#283a8f';
  g.fillRect(0, 0, w, b); g.fillRect(0, h - b, w, b); g.fillRect(0, 0, b, h); g.fillRect(w - b, 0, b, h);
  g.fillStyle = '#ffffff';
  for (let x = 0; x < w; x += c * 2) { g.fillRect(x, 0, c, c); g.fillRect(x + c, c, c, c); g.fillRect(x, h - b, c, c); g.fillRect(x + c, h - b + c, c, c); }
  for (let y = b; y < h - b; y += c * 2) { g.fillRect(0, y, c, c); g.fillRect(c, y + c, c, c); g.fillRect(w - b, y, c, c); g.fillRect(w - b + c, y + c, c, c); }
}

export function drawFrameArt(g: CanvasRenderingContext2D, w: number, h: number, s: FrameSpec): void {
  if (s.filter) applyFilter(g, w, h, s.filter);
  const frame = s.frame ?? 'blossom';
  if (frame === 'blossom') { branch(g, w, h, 1, s.live ? 0.5 : 0.62, !!s.live); branch(g, w, h, -1, s.live ? 0.42 : 0.52, !!s.live); }
  if (frame === 'parade') checkerBorder(g, w, h);
  if (!s.title || s.live || !wm || !logo) return;
  const lw = w * (s.titleWidth ?? 0.3), lh = lockupHeight(lw);
  const m = Math.min(w, h) * (frame === 'parade' ? 0.07 : 0.035);
  const left = s.titleAt === 'bottom-left';
  const x = left ? m : w - lw - m, y = s.titleAt === 'top' ? m : h - lh - m;
  if (frame === 'parade') {
    const p = lw * 0.06;
    g.fillStyle = '#ffffff';
    g.beginPath(); g.roundRect(x - p, y - p, lw + 2 * p, lh + 2 * p, p * 1.5); g.fill();
  }
  drawLockup(g, x, y, lw);
}
