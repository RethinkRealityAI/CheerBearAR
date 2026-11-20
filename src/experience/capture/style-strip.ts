// The live frame + filter picker (Selfie), Instagram / Snapchat style: one row of round glass chips above the
// shutter, each with a tiny preview of what it does and its name under it. Frames first, a thin divider, then filters,
// with a small caption under each group. A tap applies it to the live view at once (the frame on the overlay canvas,
// the filter as a cheap CSS look on the camera canvas) and to the next photo or video exactly (frame-art.ts draws the
// same frame and runs the per-pixel filter). Two radio groups, so screen readers hear "Frame, Rainbow, selected"; the
// row scrolls sideways on narrow phones. Ported from the Happi demo (round 5), re-skinned for Cheer Bear.
import { el, esc } from './ui';
import { FRAME_STYLES, PHOTO_FILTERS, applyFilter, cloud, drawFrameArt, heart, loadFrameArt, type FrameStyle, type PhotoFilter } from './frame-art';

/** The live look of each filter on the camera canvas (close to applyFilter, GPU-cheap on every phone). */
export const FILTER_CSS: Record<PhotoFilter, { filter: string; tint: string }> = {
  natural: { filter: '', tint: '' },
  warm: { filter: 'sepia(0.16) saturate(1.12) brightness(1.03)', tint: '' },
  candy: { filter: 'brightness(1.03) saturate(1.08)', tint: 'rgba(255, 214, 234, 0.16)' },
  mono: { filter: 'grayscale(1) contrast(1.12)', tint: '' },
};

export interface StyleStrip {
  el: HTMLElement;
  set(frame: FrameStyle, filter: PhotoFilter): void;
}

const PX = 112; // preview canvas size (drawn at 2x for a 56 px chip)

export function styleStrip(frame: FrameStyle, filter: PhotoFilter, onPick: (frame: FrameStyle, filter: PhotoFilter) => void): StyleStrip {
  const wrap = el('div', 'cbc-strip');
  const row = el('div', 'cbc-strip-row');
  wrap.appendChild(row);
  let cur = { frame, filter };
  const frameBtns = new Map<FrameStyle, HTMLButtonElement>();
  const filterBtns = new Map<PhotoFilter, HTMLButtonElement>();

  const group = (label: string, caption: string) => {
    const sec = el('div', 'cbc-strip-sec');
    const g = el('div', 'cbc-strip-group');
    g.setAttribute('role', 'radiogroup');
    g.setAttribute('aria-label', label);
    const cap = el('span', 'cbc-strip-cap', esc(caption));
    cap.setAttribute('aria-hidden', 'true');
    sec.append(g, cap);
    row.appendChild(sec);
    return g;
  };
  const chip = (g: HTMLElement, id: string, label: string, onClick: () => void) => {
    const b = el('button', 'cbc-chipc', `<span class="cbc-chipc-face"><canvas width="${PX}" height="${PX}" aria-hidden="true"></canvas></span><span class="cbc-chipc-label">${esc(label)}</span>`);
    b.type = 'button';
    b.dataset.id = id;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
      try { b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); } catch { /* old browsers */ }
    });
    g.appendChild(b);
    return b;
  };

  const fg = group('Frame', 'Frame');
  for (const f of FRAME_STYLES) frameBtns.set(f.id, chip(fg, f.id, f.label, () => { cur = { ...cur, frame: f.id }; sync(); onPick(cur.frame, cur.filter); }));
  row.appendChild(el('span', 'cbc-strip-div'));
  const lg = group('Filter', 'Filter');
  for (const f of PHOTO_FILTERS) filterBtns.set(f.id, chip(lg, f.id, f.label, () => { cur = { ...cur, filter: f.id }; sync(); onPick(cur.frame, cur.filter); }));

  const sync = () => {
    for (const [k, b] of frameBtns) b.setAttribute('aria-checked', String(k === cur.frame));
    for (const [k, b] of filterBtns) b.setAttribute('aria-checked', String(k === cur.filter));
  };
  sync();

  // frame previews: each frame drawn straight onto its round chip over a little sky with a face shape (Clean shows
  // the title cloud, the only thing it adds)
  void loadFrameArt().then(() => {
    for (const [id, b] of frameBtns) {
      const g = b.querySelector('canvas')!.getContext('2d')!;
      g.fillStyle = '#d4edff'; g.fillRect(0, 0, PX, PX);
      g.fillStyle = '#f2cdb4'; g.beginPath(); g.ellipse(PX / 2, PX * 0.62, PX * 0.2, PX * 0.26, 0, 0, Math.PI * 2); g.fill();
      drawFrameArt(g, PX, PX, { title: id === 'clean', titleWidth: 0.86, titleTop: 0.1, frame: id });
    }
  });
  // filter previews: a little flat Care-a-Lot scene (sky, sun, rainbow, a heart, a cloud), run through the filter
  for (const [id, b] of filterBtns) {
    const g = b.querySelector('canvas')!.getContext('2d', { willReadFrequently: true })!;
    scene(g, PX);
    applyFilter(g, PX, PX, id);
  }

  return { el: wrap, set(f, l) { cur = { frame: f, filter: l }; sync(); } };
}

function scene(g: CanvasRenderingContext2D, s: number): void {
  g.fillStyle = '#9fd3fb'; g.fillRect(0, 0, s, s);
  g.fillStyle = '#ffd84a'; g.beginPath(); g.arc(s * 0.78, s * 0.24, s * 0.12, 0, Math.PI * 2); g.fill();
  const bands = ['#ff5a5f', '#ff9a3d', '#ffd84a', '#5fcf86', '#439bdd', '#9a6bff'];
  bands.forEach((c, i) => {
    g.strokeStyle = c; g.lineWidth = s * 0.05;
    g.beginPath(); g.arc(s * 0.5, s * 0.95, s * (0.5 - i * 0.05), Math.PI, 0); g.stroke();
  });
  g.fillStyle = '#5fcf86'; g.fillRect(0, s * 0.86, s, s * 0.14);
  cloud(g, s * 0.02, s * 0.62, s * 0.4, false);
  heart(g, s * 0.62, s * 0.66, s * 0.3, 0.12, '#ff389b');
}
