// The live frame + filter picker (Selfie), Instagram / Snapchat style: round glass chips, each with a tiny preview of
// what it does and its name under it. A tap applies it to the live view at once (the frame on the overlay canvas, the
// filter as a cheap CSS look on the camera canvas) and to the next photo or video exactly (frame-art.ts draws the same
// frame and runs the per-pixel filter). Ported from the Happi demo (round 5), re-skinned for Cheer Bear.
//
// polish-6 (round 6, Dapo: "seeing all the frames all at once is looking a little too busy"): the chips no longer
// all show at once. A compact two-part toggle under the look picker, in the same glass style, names the current
// choice ("Frame · Rainbow" | "Filter · Natural"); tapping one opens ONE row of chips (frames OR filters) just above
// it, tapping it again (or the camera view, or Esc) folds the row away. Collapsed by default. Each row is a radio group,
// so screen readers hear "Frame, Rainbow, selected"; the toggles say expanded / collapsed.
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
  /** The chip row (one group at a time; hidden while folded). */
  el: HTMLElement;
  /** The compact Frame | Filter toggle that opens it. */
  toggle: HTMLElement;
  set(frame: FrameStyle, filter: PhotoFilter): void;
  /** Open one row (or fold it away with null). */
  open(which: StyleGroup | null): void;
  readonly opened: StyleGroup | null;
}
export type StyleGroup = 'frame' | 'filter';

const PX = 112; // preview canvas size (drawn at 2x for a 56 px chip)
let seq = 0;

const FRAME_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M12 15.6s-3.4-2-3.4-4.2a1.8 1.8 0 0 1 3.4-.9 1.8 1.8 0 0 1 3.4.9c0 2.2-3.4 4.2-3.4 4.2z" fill="currentColor" stroke="none"/></svg>';
const FILTER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="9" cy="10" r="5.5"/><circle cx="15" cy="10" r="5.5"/><circle cx="12" cy="15" r="5.5"/></svg>';

export function styleStrip(frame: FrameStyle, filter: PhotoFilter, onPick: (frame: FrameStyle, filter: PhotoFilter) => void): StyleStrip {
  const id = `cbc-strip-${++seq}`;
  const wrap = el('div', 'cbc-strip');
  wrap.id = id;
  wrap.hidden = true;
  const row = el('div', 'cbc-strip-row');
  wrap.appendChild(row);
  let cur = { frame, filter };
  let opened: StyleGroup | null = null;
  const frameBtns = new Map<FrameStyle, HTMLButtonElement>();
  const filterBtns = new Map<PhotoFilter, HTMLButtonElement>();

  const group = (label: string, kind: StyleGroup) => {
    const g = el('div', 'cbc-strip-group');
    g.setAttribute('role', 'radiogroup');
    g.setAttribute('aria-label', label);
    g.dataset.group = kind;
    row.appendChild(g);
    return g;
  };
  const chip = (g: HTMLElement, cid: string, label: string, onClick: () => void) => {
    const b = el('button', 'cbc-chipc', `<span class="cbc-chipc-face"><canvas width="${PX}" height="${PX}" aria-hidden="true"></canvas></span><span class="cbc-chipc-label">${esc(label)}</span>`);
    b.type = 'button';
    b.dataset.id = cid;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
      try { b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); } catch { /* old browsers */ }
    });
    g.appendChild(b);
    return b;
  };

  const fg = group('Frame', 'frame');
  for (const f of FRAME_STYLES) frameBtns.set(f.id, chip(fg, f.id, f.label, () => { cur = { ...cur, frame: f.id }; sync(); onPick(cur.frame, cur.filter); }));
  const lg = group('Filter', 'filter');
  for (const f of PHOTO_FILTERS) filterBtns.set(f.id, chip(lg, f.id, f.label, () => { cur = { ...cur, filter: f.id }; sync(); onPick(cur.frame, cur.filter); }));

  // the toggle: two halves in the look picker's glass style; each names what is on now
  const toggle = el('div', 'cbc-styletog');
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'Frame and filter');
  const half = (kind: StyleGroup, icon: string, name: string) => {
    const b = el('button', '', `${icon}<span class="cbc-styletog-k">${name}</span><span class="cbc-styletog-v"></span><i class="cbc-styletog-chev" aria-hidden="true"></i>`);
    b.type = 'button';
    b.dataset.group = kind;
    b.setAttribute('aria-controls', id);
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', (e) => { e.stopPropagation(); open(opened === kind ? null : kind); });
    toggle.appendChild(b);
    return b;
  };
  const tFrame = half('frame', FRAME_ICON, 'Frame');
  const tFilter = half('filter', FILTER_ICON, 'Filter');

  const open = (which: StyleGroup | null) => {
    opened = which;
    wrap.hidden = !which;
    fg.hidden = which !== 'frame';
    lg.hidden = which !== 'filter';
    toggle.dataset.open = which ?? '';
    tFrame.setAttribute('aria-expanded', String(which === 'frame'));
    tFilter.setAttribute('aria-expanded', String(which === 'filter'));
    if (which) {
      wrap.classList.remove('cbc-strip-in');
      void wrap.offsetWidth; // replay the rise
      wrap.classList.add('cbc-strip-in');
      const on = (which === 'frame' ? frameBtns.get(cur.frame) : filterBtns.get(cur.filter));
      try { on?.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch { /* old browsers */ }
    }
  };
  wrap.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !opened) return;
    e.stopPropagation();
    const back = opened === 'frame' ? tFrame : tFilter;
    open(null);
    back.focus();
  });

  const sync = () => {
    for (const [k, b] of frameBtns) b.setAttribute('aria-checked', String(k === cur.frame));
    for (const [k, b] of filterBtns) b.setAttribute('aria-checked', String(k === cur.filter));
    const fl = FRAME_STYLES.find((f) => f.id === cur.frame)?.label ?? '';
    const ll = PHOTO_FILTERS.find((f) => f.id === cur.filter)?.label ?? '';
    tFrame.querySelector('.cbc-styletog-v')!.textContent = fl;
    tFilter.querySelector('.cbc-styletog-v')!.textContent = ll;
    tFrame.setAttribute('aria-label', `Frame: ${fl}. Show the frames`);
    tFilter.setAttribute('aria-label', `Filter: ${ll}. Show the filters`);
  };
  sync();
  open(null);

  // frame previews: each frame drawn straight onto its round chip over a little sky with a face shape (Clean shows
  // the title cloud, the only thing it adds)
  void loadFrameArt().then(() => {
    for (const [fid, b] of frameBtns) {
      const g = b.querySelector('canvas')!.getContext('2d')!;
      g.fillStyle = '#d4edff'; g.fillRect(0, 0, PX, PX);
      g.fillStyle = '#f2cdb4'; g.beginPath(); g.ellipse(PX / 2, PX * 0.62, PX * 0.2, PX * 0.26, 0, 0, Math.PI * 2); g.fill();
      drawFrameArt(g, PX, PX, { title: fid === 'clean', titleWidth: 0.86, titleTop: 0.1, frame: fid });
    }
  });
  // filter previews: a little flat Care-a-Lot scene (sky, sun, rainbow, a heart, a cloud), run through the filter
  for (const [fid, b] of filterBtns) {
    const g = b.querySelector('canvas')!.getContext('2d', { willReadFrequently: true })!;
    scene(g, PX);
    applyFilter(g, PX, PX, fid);
  }

  return {
    el: wrap, toggle, open,
    get opened() { return opened; },
    set(f, l) { cur = { frame: f, filter: l }; sync(); },
  };
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
