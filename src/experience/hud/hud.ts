// The experience's own DOM: splash, top bar (small title, mode switcher, menu), hint pill, toast, speech bubble,
// bottom row (left: Move; centre: joystick or shutter; right: kept free for the app's talk button), sheets (menu,
// how it works, licences, open-on-phone QR, errors) and the flat cover shown while the camera switches.
import * as THREE from 'three';
import qrcode from 'qrcode-generator';
import type { ExperienceMode } from '../../shared/contracts';
import type { HudApi } from '../types';
import { ICON } from './icons';
import { recorder, CLIP_MAX_S } from '../capture/recorder';
import './hud.css';

const MODES: Array<{ id: ExperienceMode; label: string; icon: string; aria: string }> = [
  { id: 'showcase', label: '3D', icon: ICON.cube, aria: '3D: Cheer Bear in Care-a-Lot' },
  { id: 'ar', label: 'AR', icon: ICON.ar, aria: 'AR: Cheer Bear in your room' },
  { id: 'face', label: 'Selfie', icon: ICON.selfie, aria: 'Selfie with Cheer Bear' },
  { id: 'photo', label: 'Photo', icon: ICON.photo, aria: '3D photo with Cheer Bear' },
];

/** Press-and-hold video on a shutter: start() returns false when this view can't record right now. */
export interface ShutterHold {
  start(): boolean;
  stop(): void;
}

export interface HudOptions {
  title: string;
  lead: string;
  onStart(): void;
  onSwitch(mode: ExperienceMode): void;
  onRestart(): void;
  /** The Actions / Games pair (bottom right) was tapped. */
  onDock?(kind: 'actions' | 'games'): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * A flat heart with a face hopping on a sky disc under a flat rainbow, a new expression on every landing (happy,
 * wink, surprised, grin). Our own simple shapes (no Care Bears art). The loading hero and the mode-change cover.
 */
const HH_FACES = [
  // happy
  '<circle cx="44" cy="46" r="5.5"/><circle cx="76" cy="46" r="5.5"/><path d="M47 61q13 12 26 0" fill="none" stroke-width="5" stroke-linecap="round"/>',
  // wink
  '<path d="M38 47q6-7 12 0" fill="none" stroke-width="5" stroke-linecap="round"/><circle cx="76" cy="46" r="5.5"/><path d="M47 61q13 12 26 0" fill="none" stroke-width="5" stroke-linecap="round"/>',
  // surprised
  '<circle cx="44" cy="45" r="6.5"/><circle cx="76" cy="45" r="6.5"/><ellipse cx="60" cy="66" rx="6" ry="7"/>',
  // grin
  '<path d="M38 48q6-8 12 0M70 48q6-8 12 0" fill="none" stroke-width="5" stroke-linecap="round"/><path d="M45 59h30q-2 17-15 17t-15-17z"/>',
];
function heartHop(cls = ''): string {
  const faces = HH_FACES.map((f, i) => `<g class="hh-face" style="--k:${i}">${f}</g>`).join('');
  return `<div class="hh ${cls}" aria-hidden="true"><i class="hh-ring"><svg class="hh-bow" viewBox="0 0 100 52"><g fill="none" stroke-width="7"><path d="M8 50a42 42 0 0 1 84 0" stroke="#ff5a5f"/><path d="M15 50a35 35 0 0 1 70 0" stroke="#ffd84a"/><path d="M22 50a28 28 0 0 1 56 0" stroke="#5fcf86"/><path d="M29 50a21 21 0 0 1 42 0" stroke="#439bdd"/></g></svg></i><i class="hh-shadow"></i><span class="hh-head"><svg viewBox="0 0 120 108"><path class="hh-heart" d="M60 101S9 72 7 39C5.6 17 20 5 36 5c11 0 19 6 24 14 5-8 13-14 24-14 16 0 30.4 12 29 34-2 33-53 62-53 62z"/><ellipse class="hh-cheek" cx="33" cy="60" rx="7.5" ry="4.6"/><ellipse class="hh-cheek" cx="87" cy="60" rx="7.5" ry="4.6"/>${faces}</svg></span></div>`;
}

export class Hud implements HudApi {
  readonly root: HTMLElement;
  readonly hudEl: HTMLElement;
  readonly left: HTMLElement;
  /** Bottom-right column: stacks bottom-up ABOVE the app's talk button (the reserved corner). Actions + Games live here. */
  readonly right: HTMLElement;
  readonly centre: HTMLElement;
  readonly above: HTMLElement;
  readonly layer: HTMLElement;
  private splash: HTMLElement;
  private startBtn: HTMLButtonElement;
  private loadBar: HTMLElement;
  private hintEl: HTMLElement;
  private hintT = 0;
  private toastEl: HTMLElement;
  private bubble: HTMLElement;
  private bubbleWords: HTMLElement;
  private bubbleSr: HTMLElement;
  private speechWords: string[] = [];
  private speechT = 0;
  private coverEl: HTMLElement;
  private coverDisc: HTMLElement;
  private coverIcon: HTMLElement;
  private coverText: HTMLElement;
  private coverTitle: HTMLElement;
  private dockEl: HTMLElement;
  /** camera-5: the capture shutter at the top of the dock (3D and AR), and how to stop a clip it is holding. */
  private dockShot: HTMLButtonElement | null = null;
  private holdStops = new WeakMap<HTMLButtonElement, () => void>();
  /** The "Hold for video" cue by the capture tile shows once per page load (polish-6). */
  private shotCued = false;
  private fx: HTMLElement;
  private coverOutT = 0;
  private coverOnAt = 0;
  private flashEl: HTMLElement;
  private switchEl: HTMLElement;
  private switchPill: HTMLElement;
  private switchBtns = new Map<ExperienceMode, HTMLButtonElement>();
  private curMode: ExperienceMode = 'showcase';
  private busy = false;
  /** A mode tapped while a switch was running: the last tap wins once the switch ends. */
  private pending: ExperienceMode | null = null;
  /** Where the mode-change iris grows from (the tapped tab's centre, in container px). */
  private irisFrom: { x: number; y: number } | null = null;
  private stick: HTMLElement;
  private stickKnob: HTMLElement;
  private stickState = { vector: new THREE.Vector2(), active: false };
  private toastT = 0;
  private hintText = '';
  private openSheets: HTMLElement[] = [];

  constructor(container: HTMLElement, private opts: HudOptions) {
    this.root = container;

    // ---- splash (full branded: title art, the bear as hero, one-line lead, Start, loading bar, Activated by MEDIALIFE).
    // The entrance (chrome-5, round 5): flat clouds drift across the sky, hearts and sparkles float up behind the
    // card, the title drops in and floats, the card's lines rise one by one; Start bursts hearts when tapped.
    this.splash = el('section', 'cbx-splash');
    this.splash.setAttribute('aria-label', opts.title);
    this.splash.innerHTML = `
      <div class="sp-col">
        <div class="sp-top"><div class="sp-clouds" aria-hidden="true"><i></i><i></i><i></i></div><img class="title" src="/img/cb-title.webp" alt="${esc(opts.title)}" width="450" height="238"></div>
        <div class="sp-bottom">
          <p class="lead">${esc(opts.lead)}</p>
          <button type="button" class="cbx-start" disabled>Loading…</button>
          <div class="cbx-load" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100"><i></i></div>
          <img class="act-by" src="/img/activated-by.webp" alt="Activated by MEDIALIFE" width="148" height="58">
        </div>
      </div>
      <div class="sp-hero"><div class="sp-wait" aria-hidden="true">${heartHop('hh-sm')}</div></div>`;
    // portrait order: title, hero window, card (the column wrapper is display: contents there)
    const col = this.splash.querySelector('.sp-col')!;
    const hero = this.splash.querySelector('.sp-hero')!;
    col.insertBefore(hero, col.querySelector('.sp-bottom'));
    if (matchMedia('(min-aspect-ratio: 1/1) and (min-width: 700px)').matches) this.splash.appendChild(hero);
    this.startBtn = this.splash.querySelector('.cbx-start')!;
    this.loadBar = this.splash.querySelector('.cbx-load')!;
    this.startBtn.addEventListener('click', () => { this.burst(); opts.onStart(); });
    // hearts and sparkles floating up (flat shapes, CSS only: transform + opacity)
    this.fx = el('div', 'sp-fx');
    this.fx.setAttribute('aria-hidden', 'true');
    this.fx.innerHTML = Array.from({ length: 14 }, (_, i) => {
      const kind = i % 3 === 2 ? 'sp-spark' : 'sp-heart';
      const tone = ['t1', 't2', 't3', 't4'][i % 4];
      const x = ((i * 37) % 92) + 4, d = 9 + ((i * 7) % 8), delay = -((i * 1.9) % d), s = 0.6 + ((i * 13) % 9) / 10;
      return `<i class="${kind} ${tone}" style="--x:${x}%;--d:${d}s;--dl:${delay.toFixed(1)}s;--s:${s.toFixed(2)};--sw:${(i % 2 ? 1 : -1) * (10 + (i * 5) % 18)}px"></i>`;
    }).join('');
    this.splash.prepend(this.fx);

    // ---- HUD
    this.hudEl = el('div', 'cbx-hud');
    this.hudEl.hidden = true;
    // top (polish-6, round 6, Dapo: "the menu should be on the same line as the lockup, top right; the mode switcher
    // top centre, on the next line, between those items"): row 1 = the one-line lockup top left and Menu top right,
    // row 2 = the mode tabs centred under them (a CSS grid, hud.css). Wide screens: one row (lockup, tabs centred,
    // menu). Selfie hides the lockup (its frame carries the title cloud) but keeps the rows, so nothing jumps.
    const top = el('div', 'cbx-top');
    const lockup = el('div', 'cbx-lockup', `<img src="/img/cb-lockup.webp" alt="" width="295" height="63"><b aria-hidden="true">AR</b>`);
    lockup.setAttribute('role', 'img');
    lockup.setAttribute('aria-label', `${opts.title} AR`);
    // Mode switcher: a tablist with ONE sliding selection pill (transform only, so it springs at 60 fps with no
    // layout). Manual activation: arrow keys move focus, Enter / Space switch (each switch may start a camera).
    this.switchEl = el('div', 'cbx-switch');
    this.switchEl.setAttribute('role', 'tablist');
    this.switchEl.setAttribute('aria-label', 'View');
    this.switchPill = el('span', 'cbx-switch-pill', '<i></i>');
    this.switchPill.setAttribute('aria-hidden', 'true');
    this.switchEl.appendChild(this.switchPill);
    MODES.forEach((m, i) => {
      const b = el('button', '', `${m.icon}<span>${m.label}</span>`);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === 0));
      b.tabIndex = i === 0 ? 0 : -1;
      b.setAttribute('aria-label', m.aria);
      b.dataset.mode = m.id;
      b.addEventListener('click', () => this.pick(m.id));
      this.switchBtns.set(m.id, b);
      this.switchEl.appendChild(b);
    });
    this.switchEl.style.setProperty('--i', '0');
    this.switchEl.addEventListener('keydown', (e) => this.onSwitchKey(e));
    const menuBtn = el('button', 'cbx-ib cbx-menu', ICON.menu);
    menuBtn.type = 'button';
    menuBtn.setAttribute('aria-label', 'Menu');
    menuBtn.setAttribute('aria-haspopup', 'dialog');
    menuBtn.addEventListener('click', () => this.openMenu());
    top.append(lockup, menuBtn, this.switchEl);

    this.hintEl = el('p', 'ml-hint');
    this.hintEl.setAttribute('role', 'status');
    this.hintEl.setAttribute('aria-live', 'polite');
    this.toastEl = el('div', 'cbx-toast');
    this.toastEl.setAttribute('aria-hidden', 'true');
    // what Cheer Bear says: the words reveal one by one as the transcript grows; screen readers get the plain text
    this.bubble = el('div', 'cbx-bubble', `<b class="cbx-bubble-name" aria-hidden="true">${esc(opts.title.replace(/\s+(AR|AI)$/i, '') || 'Cheer Bear')}</b><span class="cbx-bubble-text" aria-hidden="true"></span><span class="cbx-sr" role="status" aria-live="polite"></span>`);
    this.bubbleWords = this.bubble.querySelector('.cbx-bubble-text')!;
    this.bubbleSr = this.bubble.querySelector('.cbx-sr')!;
    this.above = el('div', 'cbx-above');
    const bottom = el('div', 'cbx-bottom');
    this.left = el('div', 'cbx-slot-left');
    this.centre = el('div', 'cbx-slot-centre');
    this.right = el('div', 'cbx-slot-right');
    bottom.append(this.left, this.centre, this.right);
    // Actions + Games: one pair, bottom right above the talk button (dock(true) shows it). The app opens its sheet
    // on those tabs; without the app (the experience alone) they open the experience's own small sheets.
    this.dockEl = el('div', 'cbx-dock');
    this.dockEl.hidden = true;
    const dockBtn = (kind: 'actions' | 'games', label: string, icon: string, aria: string) => {
      const b = this.toolButton({ label, icon, aria, onClick: () => this.opts.onDock?.(kind) });
      b.classList.add('cbx-pd', `is-${kind}`);
      b.dataset.cmd = kind;
      return b;
    };
    this.dockEl.append(
      dockBtn('actions', 'Actions', ICON.actions, 'Actions: pick something for Cheer Bear to do'),
      dockBtn('games', 'Games', ICON.games, 'Games: play with Cheer Bear'),
    );
    this.right.appendChild(this.dockEl);
    // (polish-6, round 6: Selfie and Photo have no Actions toggle or talk button any more: the camera views stay clear)

    // joystick (bottom centre, walking modes): a plain branded stick: glass base, a thin white ring with one short
    // white arc gliding round it (a flat shimmer, no gradient), a white thumb with a small pink heart. No arrows.
    this.stick = el('div', 'cbx-stick pe', `<svg class="cbx-stick-ring" viewBox="0 0 116 116" aria-hidden="true"><circle cx="58" cy="58" r="53" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.45"/><circle class="arc" cx="58" cy="58" r="53" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" pathLength="100" stroke-dasharray="14 86"/></svg><span>${ICON.heart}</span>`);
    this.stick.setAttribute('role', 'application');
    this.stick.setAttribute('aria-label', 'Joystick: walk Cheer Bear');
    this.stick.hidden = true;
    this.stickKnob = this.stick.querySelector('span') as HTMLElement;
    this.bindStick();

    this.hudEl.append(top, this.hintEl, this.toastEl, this.bubble, this.above, bottom);
    this.layer = el('div', 'cbx-layer');

    // the mode-change cover (chrome-5, round 5): a flat iris in the destination's colour grows from the tapped tab,
    // clouds drift across it, the heart hops on its rainbow disc (a new face on every landing) above "Switching to
    // AR" and the camera line; then the whole cover fades off the new view (reduced motion: a plain crossfade)
    this.coverEl = el('div', 'cbx-cover', `<i class="cbx-cover-disc"></i><div class="cbx-cover-sky" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="cbx-cover-in">${heartHop()}<strong class="cbx-cover-title"></strong><p><span class="cbx-cover-badge"></span><b></b><em class="cbx-dots"><i></i><i></i><i></i></em></p></div>`);
    this.coverEl.setAttribute('role', 'status');
    this.coverDisc = this.coverEl.querySelector('.cbx-cover-disc')!;
    this.coverIcon = this.coverEl.querySelector('.cbx-cover-badge')!;
    this.coverText = this.coverEl.querySelector('.cbx-cover-in p b')!;
    this.coverTitle = this.coverEl.querySelector('.cbx-cover-title')!;
    this.flashEl = el('div', 'cbx-flash');

    container.append(this.layer, this.hudEl, this.splash, this.coverEl, this.flashEl);
  }

  // ------------------------------------------------------------------ splash
  progress(p: number): void {
    const v = Math.round(Math.min(1, Math.max(0, p)) * 100);
    (this.loadBar.firstElementChild as HTMLElement).style.width = v + '%';
    this.loadBar.setAttribute('aria-valuenow', String(v));
  }
  bearReady(): void {
    this.splash.classList.add('bear-ready');
  }
  ready(): void {
    this.progress(1);
    this.loadBar.classList.add('done');
    this.startBtn.disabled = false;
    this.startBtn.textContent = 'Start';
    this.startBtn.classList.add('ready');
  }
  starting(): void {
    this.startBtn.disabled = true;
    this.startBtn.textContent = 'Starting…';
  }
  /** The CSS-pixel rectangle of the splash's hero window (the showcase frames the bear inside it). */
  heroRect(): DOMRect | null {
    const h = this.splash.querySelector('.sp-hero');
    return h && !this.splash.hidden ? h.getBoundingClientRect() : null;
  }
  hideSplash(): void {
    this.splash.classList.add('gone');
    this.irisFrom = null;
    this.hudEl.hidden = false;
    this.hudEl.classList.add('off');
    requestAnimationFrame(() => this.hudEl.classList.remove('off'));
    window.setTimeout(() => { if (this.splash.classList.contains('gone')) this.splash.hidden = true; }, 1000);
  }
  /** Start was tapped: a one-shot burst of flat hearts and sparkles out of the button (none with reduced motion). */
  private burst(): void {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = this.startBtn.getBoundingClientRect(), box = this.splash.getBoundingClientRect();
    const b = el('div', 'sp-burst');
    b.setAttribute('aria-hidden', 'true');
    b.style.left = `${r.left + r.width / 2 - box.left}px`;
    b.style.top = `${r.top + r.height / 2 - box.top}px`;
    const n = 18;
    b.innerHTML = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + (i % 2) * 0.17;
      const d = 90 + ((i * 29) % 70);
      const kind = i % 3 === 1 ? 'sp-spark' : 'sp-heart';
      return `<i class="${kind} t${(i % 4) + 1}" style="--bx:${Math.round(Math.cos(a) * d * 1.25)}px;--by:${Math.round(Math.sin(a) * d - 40)}px;--s:${(0.7 + (i % 5) * 0.12).toFixed(2)};--r:${(i * 47) % 90 - 45}deg"></i>`;
    }).join('');
    this.splash.appendChild(b);
    window.setTimeout(() => b.remove(), 1300);
  }
  showSplashAgain(): void {
    this.splash.hidden = false;
    this.splash.classList.remove('gone');
    this.hudEl.hidden = true;
    this.startBtn.disabled = false;
    this.startBtn.textContent = 'Start';
  }

  // ------------------------------------------------------------------ mode switcher
  setMode(mode: ExperienceMode, busy: boolean): void {
    const prev = this.curMode;
    if (prev !== mode) this.closeAllSheets(); // a sheet from the last mode (Games, Actions) never follows you
    this.curMode = mode;
    this.root.dataset.mode = mode;
    this.busy = busy;
    const i = MODES.findIndex((m) => m.id === mode);
    const focused = this.switchEl.contains(document.activeElement);
    for (const [id, b] of this.switchBtns) {
      const on = id === mode;
      b.setAttribute('aria-selected', String(on));
      // aria-disabled (not disabled) while a camera starts, so keyboard focus stays where it is
      if (busy && !on) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
      if (!focused) b.tabIndex = on ? 0 : -1;
      b.classList.toggle('queued', busy && id === this.pending);
    }
    if (i >= 0 && this.switchEl.style.getPropertyValue('--i') !== String(i)) {
      this.switchEl.style.setProperty('--i', String(i));
      if (prev !== mode) this.squish();
    }
    this.switchEl.classList.toggle('busy', busy);
    this.switchEl.setAttribute('aria-busy', String(busy));
    if (!busy && this.pending) {
      const next = this.pending;
      this.pending = null;
      this.switchBtns.get(next)?.classList.remove('queued');
      if (next !== mode && !this.sheetOpen) window.setTimeout(() => this.pick(next), 0);
    }
  }

  private squish(): void {
    const p = this.switchPill.firstElementChild as HTMLElement;
    p.classList.remove('moving');
    void p.offsetWidth; // restart the keyframes
    p.classList.add('moving');
  }

  /** A tab was tapped (or Enter / Space). */
  private pick(id: ExperienceMode): void {
    if (this.busy) {
      // a camera is starting: remember the last tap and do it when this switch ends
      this.pending = id === this.curMode ? null : id;
      for (const [m, b] of this.switchBtns) b.classList.toggle('queued', m === this.pending);
      return;
    }
    if (id === this.curMode) return;
    try { navigator.vibrate?.(8); } catch { /* not allowed here */ }
    const b = this.switchBtns.get(id);
    if (b) {
      const r = b.getBoundingClientRect(), box = this.root.getBoundingClientRect();
      this.irisFrom = { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
    }
    this.opts.onSwitch(id);
  }

  private onSwitchKey(e: KeyboardEvent): void {
    const btns = [...this.switchBtns.values()];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % btns.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + btns.length) % btns.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = btns.length - 1;
    if (n < 0) return;
    e.preventDefault();
    btns.forEach((b, k) => { b.tabIndex = k === n ? 0 : -1; });
    btns[n].focus();
  }
  setReserved(px: number): void {
    this.root.style.setProperty('--cbx-reserved', Math.max(0, px) + 'px');
  }
  /** Show / hide the Actions + Games pair (bottom right, above the talk button). Modes call it as their state allows. */
  dock(show: boolean): void {
    const full = show === true;
    if (!full && this.dockShot) this.holdStops.get(this.dockShot)?.(); // the dock hides mid-clip: the clip ends there
    if (this.dockEl.hidden !== !full) this.dockEl.hidden = !full;
    if (full && this.dockEl.parentElement !== this.right) this.right.appendChild(this.dockEl);
    if (full && this.dockShot && !this.shotCued) this.cueShot(this.dockShot);
  }
  /** The first time the capture tile shows: a small "Hold for video" pill beside it for a few seconds. */
  private cueShot(b: HTMLButtonElement): void {
    this.shotCued = true;
    const cue = el('span', 'cbx-shot-cue', 'Hold for video');
    cue.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => {
      if (!b.isConnected || this.dockEl.hidden) { this.shotCued = false; return; } // try again next time it shows
      b.appendChild(cue);
      window.setTimeout(() => cue.remove(), 4200);
    }, 900);
  }
  /** camera-5 (round 5): put a capture shutter (from shutter()) at the TOP of the Actions + Games stack, over the talk
   *  button, or take it away (null). It shows and hides with the dock. */
  dockShutter(b: HTMLButtonElement | null): void {
    if (this.dockShot && this.dockShot !== b) {
      this.holdStops.get(this.dockShot)?.();
      this.dockShot.remove();
    }
    this.dockShot = b;
    if (b && !b.querySelector('.cbx-shot-face')) {
      // polish-6 (round 6, Dapo: "the white circle looks out of place"): a branded tile like Actions / Games: a camera
      // with a heart for a lens and "Photo" under it; recording turns it red with a white stop square and the clock
      b.classList.add('is-shot');
      b.insertAdjacentHTML('beforeend', `<span class="cbx-shot-face" aria-hidden="true">${ICON.camHeart}</span><span class="cbx-shot-lbl" aria-hidden="true">Photo</span>`);
      b.title = 'Tap for a photo, hold for a video';
    }
    if (b && b.parentElement !== this.dockEl) this.dockEl.prepend(b);
  }

  // ------------------------------------------------------------------ HudApi
  hint(text: string): void {
    text = text || '';
    if (text === this.hintText) return;
    const shown = this.hintEl.classList.contains('on');
    this.hintText = text;
    clearTimeout(this.hintT);
    const h = this.hintEl;
    if (!text) {
      // fade and sink away, then clear (the pill keeps its width while it fades)
      h.classList.remove('on', 'swap');
      this.hintT = window.setTimeout(() => { if (!this.hintText) h.textContent = ''; }, 320);
    } else if (!shown) {
      h.classList.remove('swap');
      h.textContent = text;
      void h.offsetWidth;
      h.classList.add('on'); // rise and fade in
    } else {
      // new words while showing: a quick lift-out, then the new text rises in
      h.classList.add('swap');
      this.hintT = window.setTimeout(() => { h.textContent = this.hintText; h.classList.remove('swap'); }, 170);
    }
  }
  toast(text: string, ms = 1500): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('on');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => this.toastEl.classList.remove('on'), ms);
  }
  /**
   * Cheer Bear's words. Text that continues what is showing (a growing transcript) only reveals the new words; other
   * text replaces it, revealed word by word. Long speech keeps its latest words.
   */
  speech(text: string | null): void {
    clearTimeout(this.speechT);
    const t = (text ?? '').replace(/\s+/g, ' ').trim();
    if (!t) {
      this.bubble.classList.remove('on');
      this.bubbleSr.textContent = '';
      this.speechT = window.setTimeout(() => { this.bubbleWords.textContent = ''; this.speechWords = []; }, 300);
      return;
    }
    let words = t.split(' ');
    let clipped = false;
    if (words.length > 26) { words = words.slice(-24); clipped = true; }
    const prev = this.bubble.classList.contains('on') ? this.speechWords : [];
    let keep = 0;
    while (keep < prev.length && keep < words.length && prev[keep] === words[keep]) keep++;
    // a partial word that grew ("Hel" -> "Hello") is replaced, not re-revealed from the start
    if (clipped || keep === 0 || keep < prev.length - 1) keep = 0;
    const spans = this.bubbleWords.children;
    while (spans.length > keep) spans[spans.length - 1].remove();
    const fresh = words.slice(keep);
    const step = Math.min(70, 1100 / Math.max(1, fresh.length));
    fresh.forEach((w, k) => {
      const s = document.createElement('span');
      s.textContent = (keep + k === 0 && clipped ? '…' : '') + w + ' ';
      s.style.animationDelay = `${Math.round(k * step)}ms`;
      this.bubbleWords.appendChild(s);
    });
    this.speechWords = words;
    this.bubbleSr.textContent = t;
    this.bubble.classList.add('on');
  }
  toolButton(o: { label: string; icon: string; aria?: string; onClick: () => void }): HTMLButtonElement {
    const b = el('button', 'cbx-tool', `${o.icon}<span>${esc(o.label)}</span>`);
    b.type = 'button';
    b.setAttribute('aria-label', o.aria ?? o.label);
    b.addEventListener('click', (e) => { e.stopPropagation(); o.onClick(); });
    return b;
  }
  pill(label: string, onClick: () => void, light = false): HTMLButtonElement {
    const b = el('button', 'cbx-pill' + (light ? ' light' : ''), esc(label));
    b.type = 'button';
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }
  /**
   * The round shutter. With `hold` (camera-5, round 5): tap = photo, press and hold = video. Holding past 0.28 s calls
   * hold.start() (false = can't record here: nothing happens, letting go takes no photo); letting go calls
   * hold.stop(). A red ring fills over the clip limit while it records (CSS in capture/capture.css). Keyboard Enter /
   * Space is always a photo.
   */
  shutter(onClick: () => void, aria = 'Take a photo', hold?: ShutterHold): HTMLButtonElement {
    const b = el('button', 'cbx-shutter', '<svg class="cbx-rec-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" pathLength="100"/></svg><i></i>');
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    if (!hold) {
      b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
      return b;
    }
    b.classList.add('can-rec');
    b.dataset.hold = 'video';
    const clock = el('b', 'cbx-rec-time', '0:00');
    clock.setAttribute('aria-hidden', 'true');
    b.appendChild(clock);
    let timer = 0, pid: number | null = null, recording = false, raf = 0;
    const ring = b.querySelector('circle') as SVGCircleElement;
    const loop = () => {
      if (!recording) return;
      if (!recorder.recording) { endRec(false); return; } // stopped by itself (the time limit)
      const p = Math.min(1, recorder.seconds / CLIP_MAX_S);
      ring.style.strokeDashoffset = String(100 - p * 100);
      b.style.setProperty('--rec-p', p.toFixed(3)); // (the dock's capture tile shows it as a bar)
      const sec = Math.floor(recorder.seconds);
      clock.textContent = `0:${String(sec).padStart(2, '0')}`;
      raf = requestAnimationFrame(loop);
    };
    const endRec = (callStop: boolean) => {
      cancelAnimationFrame(raf);
      if (!recording) return;
      recording = false;
      b.classList.remove('rec', 'rec-wait');
      ring.style.strokeDashoffset = '100';
      b.style.removeProperty('--rec-p');
      if (callStop) hold.stop();
    };
    b.addEventListener('pointerdown', (e) => {
      if (pid !== null || b.disabled || e.button > 0) return;
      e.stopPropagation();
      pid = e.pointerId;
      try { b.setPointerCapture(e.pointerId); } catch { /* fine */ }
      b.classList.add('down');
      timer = window.setTimeout(() => {
        timer = 0;
        if (pid === null || !hold.start()) return;
        recording = true;
        clock.textContent = '0:00';
        b.classList.add('rec', 'rec-wait');
        window.setTimeout(() => b.classList.remove('rec-wait'), 600); // the first frames may take a moment
        loop();
      }, 280);
    });
    const up = (e: PointerEvent, cancel: boolean) => {
      if (e.pointerId !== pid) return;
      e.stopPropagation();
      pid = null;
      b.classList.remove('down');
      if (recording) { endRec(true); return; }
      if (timer) { clearTimeout(timer); timer = 0; if (!cancel) onClick(); }
    };
    // stop from outside (the dock hiding mid-clip): end the press, finish the clip
    this.holdStops.set(b, () => {
      if (timer) { clearTimeout(timer); timer = 0; }
      if (pid !== null) { try { b.releasePointerCapture(pid); } catch { /* gone */ } }
      pid = null;
      b.classList.remove('down');
      endRec(true);
    });
    b.addEventListener('pointerup', (e) => up(e, false));
    b.addEventListener('pointercancel', (e) => up(e, true));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    // keyboard / assistive tech (and voice commands' .click()): a click with no pointer press is a photo
    b.addEventListener('click', (e) => { e.stopPropagation(); if (e.detail === 0) onClick(); });
    return b;
  }
  flash(): void {
    this.flashEl.style.opacity = '0.85';
    window.setTimeout(() => { this.flashEl.style.opacity = '0'; }, 90);
  }
  joystick(show: boolean): { readonly vector: THREE.Vector2; readonly active: boolean } {
    if (show && this.stick.parentElement !== this.centre) this.centre.appendChild(this.stick);
    this.stick.hidden = !show;
    if (!show) this.releaseStick();
    return this.stickState;
  }
  get stickVector(): THREE.Vector2 {
    return this.stickState.vector;
  }

  private stickId: number | null = null;
  private bindStick(): void {
    const s = this.stick;
    const move = (e: PointerEvent) => {
      const r = s.getBoundingClientRect();
      const v = this.stickState.vector.set((e.clientX - (r.left + r.width / 2)) / (r.width / 2), (e.clientY - (r.top + r.height / 2)) / (r.height / 2));
      if (v.length() > 1) v.normalize();
      this.stickKnob.style.transform = `translate(${v.x * 34}px,${v.y * 34}px)`;
    };
    s.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.stickId = e.pointerId;
      try { s.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      this.stickState.active = true;
      s.classList.add('on');
      move(e);
    });
    s.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) move(e); });
    const end = (e: PointerEvent) => { if (e.pointerId === this.stickId) this.releaseStick(); };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
    s.addEventListener('lostpointercapture', end);
  }
  private releaseStick(): void {
    this.stickId = null;
    this.stickState.active = false;
    this.stickState.vector.set(0, 0);
    this.stickKnob.style.transform = '';
    this.stick.classList.remove('on');
  }

  // ------------------------------------------------------------------ cover
  /**
   * The flat cover while the camera switches. With text: a pink iris grows from the tapped tab (or the top centre)
   * and the target mode's badge appears; null: the cover fades off the new view. Resolves once fully covered, so a
   * caller may await it before tearing the old view down (optional).
   */
  cover(text: string | null): Promise<void> {
    clearTimeout(this.coverOutT);
    const c = this.coverEl;
    if (text) {
      this.coverText.textContent = text;
      const m = MODES.find((x) => x.id === this.curMode);
      this.coverIcon.innerHTML = m ? m.icon : ICON.heart;
      // each destination has its own flat colour and says where it is going
      this.coverTitle.textContent = m?.id === 'showcase' ? 'Back to 3D' : `Switching to ${m ? m.label : '3D'}`;
      c.dataset.to = m ? m.id : 'showcase';
      if (c.classList.contains('on')) return Promise.resolve();
      const box = this.root.getBoundingClientRect();
      const o = this.irisFrom ?? { x: box.width / 2, y: Math.min(60, box.height / 2) };
      const R = Math.ceil(Math.hypot(Math.max(o.x, box.width - o.x), Math.max(o.y, box.height - o.y))) + 2;
      Object.assign(this.coverDisc.style, { width: `${2 * R}px`, height: `${2 * R}px`, left: `${o.x - R}px`, top: `${o.y - R}px` });
      const wasOut = c.classList.contains('out');
      c.classList.remove('out');
      if (!wasOut) void c.offsetWidth; // start the iris from nothing
      c.classList.add('on');
      this.coverOnAt = performance.now();
      this.hudEl.classList.add('covering'); // the top bar stays above the cover; the rest of the HUD fades
      this.irisFrom = null;
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      // (never cancelled: a caller awaiting this must always go on)
      return new Promise((r) => { window.setTimeout(r, wasOut ? 0 : reduced ? 180 : 340); });
    }
    if (!c.classList.contains('on')) return Promise.resolve();
    // a fast swap still gets the whole wipe, and the branded cover stays long enough to read as a moment (the heart
    // lands at least once and changes face; chrome-5, round 5: 460 -> 950 ms) before it fades off the new view
    const minOn = matchMedia('(prefers-reduced-motion: reduce)').matches ? 300 : 950;
    const out = () => {
      c.classList.remove('on');
      c.classList.add('out');
      this.hudEl.classList.remove('covering');
      this.coverOutT = window.setTimeout(() => c.classList.remove('out'), 420);
    };
    const wait = minOn - (performance.now() - this.coverOnAt);
    if (wait > 0) this.coverOutT = window.setTimeout(out, wait); else out();
    return Promise.resolve();
  }

  // ------------------------------------------------------------------ sheets
  sheet(o: { title: string; body: string; buttons: string[]; html?: string; qr?: string }): Promise<number> {
    return new Promise((resolve) => {
      const wrap = el('div', 'cbx-sheet-wrap');
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      const sh = el('div', 'cbx-sheet');
      sh.innerHTML = `<h2>${esc(o.title)}</h2>${o.body ? `<p>${esc(o.body)}</p>` : ''}${o.html ?? ''}`;
      if (o.qr) {
        const q = el('div', 'qr', qrSvg(o.qr));
        q.setAttribute('role', 'img');
        q.setAttribute('aria-label', 'QR code that opens this page on your phone');
        sh.appendChild(q);
      }
      const row = el('div', 'row');
      o.buttons.forEach((label, i) => {
        const b = el('button', 'btn' + (i > 0 ? ' alt' : ''), esc(label));
        b.type = 'button';
        b.addEventListener('click', () => { this.closeSheet(wrap); resolve(i); });
        row.appendChild(b);
      });
      sh.appendChild(row);
      wrap.appendChild(sh);
      wrap.addEventListener('click', (e) => { if (e.target === wrap) { this.closeSheet(wrap); resolve(-1); } });
      this.root.appendChild(wrap);
      this.openSheets.push(wrap);
      (row.firstElementChild as HTMLElement | null)?.focus();
    });
  }
  private closeSheet(w: HTMLElement): void {
    w.remove();
    this.openSheets = this.openSheets.filter((x) => x !== w);
  }
  closeAllSheets(): void {
    for (const w of this.openSheets) w.remove();
    this.openSheets = [];
  }
  get sheetOpen(): boolean {
    return this.openSheets.length > 0;
  }

  openOnPhone(what: string): Promise<number> {
    const url = location.href.replace(/[?&](test|desktop|diag|verbose)\b[^&]*/g, '').replace(/[?&]$/, '');
    return this.sheet({
      title: 'Open this on your phone',
      body: `${what} uses your phone's camera. Scan this to open it there. The 3D view, talking and games work right here.`,
      buttons: ['Close'],
      qr: url,
    });
  }

  private openMenu(): void {
    const wrap = el('div', 'cbx-sheet-wrap');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Menu');
    wrap.innerHTML = `<div class="cbx-sheet">
      <h2>${esc(this.opts.title)}</h2>
      <button type="button" class="mi" data-a="how">How it works<span aria-hidden="true">›</span></button>
      <button type="button" class="mi" data-a="restart">Start again<span aria-hidden="true">↺</span></button>
      <div class="row"><button type="button" class="btn" data-a="close">Back</button></div>
      <button type="button" class="small-link" data-a="lic">Licences</button>
    </div>`;
    wrap.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (e.target === wrap || a) this.closeSheet(wrap);
      if (a === 'how') this.openHow();
      if (a === 'restart') this.opts.onRestart();
      if (a === 'lic') this.openLicences();
    });
    this.root.appendChild(wrap);
    this.openSheets.push(wrap);
    (wrap.querySelector('.mi') as HTMLElement).focus();
  }

  openHow(): void {
    void this.sheet({
      title: 'How it works',
      body: '',
      html: `<ol>
        <li><b>Talk to her</b>: hold the pink mic, say <b>rainbow</b>, <b>dance</b>, <b>party</b> or <b>house</b>, then let go. You can call her too.</li>
        <li><b>Actions</b> makes her do something. <b>Games</b> has Heart Run, Heart Hoops and word games.</li>
        <li><b>3D</b>: drag to look around; the joystick walks her. <b>AR</b>: point at the floor and tap <b>Place</b>.</li>
        <li><b>Photo</b> (3D and AR): tap for a picture, hold for a video. In <b>Selfie</b> and <b>Photo</b> mode it is the big white button; <b>Frame</b> and <b>Filter</b> change the look.</li>
      </ol>`,
      buttons: ['Got it'],
    });
  }

  openLicences(): void {
    void this.sheet({
      title: 'Licences',
      body: '',
      html: `<div class="lic">
        <div><b>three.js</b><br>MIT License. Copyright © 2010-2025 three.js authors.</div>
        <div><b>8th Wall Engine Binary</b><br>Used under the Niantic Spatial XR Engine License, loaded unmodified. © Niantic Spatial, Inc.
          <a href="https://8thwall.org/docs/engine/license" target="_blank" rel="noopener">Licence text</a></div>
        <div><b>Fredoka</b> (font)<br>SIL Open Font License 1.1.</div>
        <div><b>qrcode-generator</b><br>MIT License. Copyright © Kazuhiko Arase.</div>
        <div><b>Cheer Bear and Care Bears</b><br>Characters and artwork belong to their owners.</div>
      </div>`,
      buttons: ['Close'],
    });
  }

  dispose(): void {
    this.closeAllSheets();
    for (const n of [this.splash, this.hudEl, this.layer, this.coverEl, this.flashEl]) n.remove();
  }
}

function qrSvg(text: string): string {
  try {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch {
    return '';
  }
}
