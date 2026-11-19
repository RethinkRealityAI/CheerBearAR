// The experience's own DOM: splash, top bar (small title, mode switcher, menu), hint pill, toast, speech bubble,
// bottom row (left: Move; centre: joystick or shutter; right: kept free for the app's talk button), sheets (menu,
// how it works, licences, open-on-phone QR, errors) and the flat cover shown while the camera switches.
import * as THREE from 'three';
import qrcode from 'qrcode-generator';
import type { ExperienceMode } from '../../shared/contracts';
import type { HudApi } from '../types';
import { ICON } from './icons';
import './hud.css';

const MODES: Array<{ id: ExperienceMode; label: string; icon: string; aria: string }> = [
  { id: 'showcase', label: '3D', icon: ICON.cube, aria: '3D: Cheer Bear in Care-a-Lot' },
  { id: 'ar', label: 'AR', icon: ICON.ar, aria: 'AR: Cheer Bear in your room' },
  { id: 'face', label: 'Selfie', icon: ICON.selfie, aria: 'Selfie with Cheer Bear' },
  { id: 'photo', label: 'Photo', icon: ICON.photo, aria: '3D photo with Cheer Bear' },
];

export interface HudOptions {
  title: string;
  lead: string;
  onStart(): void;
  onSwitch(mode: ExperienceMode): void;
  onRestart(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Hud implements HudApi {
  readonly root: HTMLElement;
  readonly hudEl: HTMLElement;
  readonly left: HTMLElement;
  readonly centre: HTMLElement;
  readonly above: HTMLElement;
  readonly layer: HTMLElement;
  private splash: HTMLElement;
  private startBtn: HTMLButtonElement;
  private loadBar: HTMLElement;
  private hintEl: HTMLElement;
  private toastEl: HTMLElement;
  private bubble: HTMLElement;
  private coverEl: HTMLElement;
  private coverText: HTMLElement;
  private flashEl: HTMLElement;
  private switchEl: HTMLElement;
  private switchBtns = new Map<ExperienceMode, HTMLButtonElement>();
  private stick: HTMLElement;
  private stickKnob: HTMLElement;
  private stickState = { vector: new THREE.Vector2(), active: false };
  private toastT = 0;
  private hintText = '';
  private openSheets: HTMLElement[] = [];

  constructor(container: HTMLElement, private opts: HudOptions) {
    this.root = container;

    // ---- splash (full branded: title art, the bear as hero, one-line lead, Start, loading bar, Activated by MEDIALIFE)
    this.splash = el('section', 'cbx-splash');
    this.splash.setAttribute('aria-label', opts.title);
    this.splash.innerHTML = `
      <div class="sp-col">
        <div class="sp-top"><img class="title" src="/img/cb-title.webp" alt="${esc(opts.title)}" width="450" height="238"></div>
        <div class="sp-bottom">
          <p class="lead">${esc(opts.lead)}</p>
          <button type="button" class="cbx-start" disabled>Loading…</button>
          <div class="cbx-load" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100"><i></i></div>
          <img class="act-by" src="/img/activated-by.webp" alt="Activated by MEDIALIFE" width="148" height="58">
        </div>
      </div>
      <div class="sp-hero"><div class="sp-wait" aria-hidden="true">${ICON.heart}</div></div>`;
    // portrait order: title, hero window, card (the column wrapper is display: contents there)
    const col = this.splash.querySelector('.sp-col')!;
    const hero = this.splash.querySelector('.sp-hero')!;
    col.insertBefore(hero, col.querySelector('.sp-bottom'));
    if (matchMedia('(min-aspect-ratio: 1/1) and (min-width: 700px)').matches) this.splash.appendChild(hero);
    this.startBtn = this.splash.querySelector('.cbx-start')!;
    this.loadBar = this.splash.querySelector('.cbx-load')!;
    this.startBtn.addEventListener('click', () => opts.onStart());

    // ---- HUD
    this.hudEl = el('div', 'cbx-hud');
    this.hudEl.hidden = true;
    const top = el('div', 'cbx-top');
    top.innerHTML = `<img class="mini" src="/img/cb-title.webp" alt="${esc(opts.title)}" width="76" height="40">`;
    this.switchEl = el('div', 'cbx-switch');
    this.switchEl.setAttribute('role', 'group');
    this.switchEl.setAttribute('aria-label', 'View');
    for (const m of MODES) {
      const b = el('button', '', `${m.icon}<span>${m.label}</span>`);
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', m.aria);
      b.dataset.mode = m.id;
      b.addEventListener('click', () => opts.onSwitch(m.id));
      this.switchBtns.set(m.id, b);
      this.switchEl.appendChild(b);
    }
    top.appendChild(this.switchEl);
    const menuBtn = el('button', 'cbx-ib', ICON.menu);
    menuBtn.type = 'button';
    menuBtn.setAttribute('aria-label', 'Menu');
    menuBtn.setAttribute('aria-haspopup', 'dialog');
    menuBtn.addEventListener('click', () => this.openMenu());
    top.appendChild(menuBtn);

    this.hintEl = el('p', 'ml-hint');
    this.hintEl.setAttribute('role', 'status');
    this.hintEl.setAttribute('aria-live', 'polite');
    this.toastEl = el('div', 'cbx-toast');
    this.toastEl.setAttribute('aria-hidden', 'true');
    this.bubble = el('div', 'cbx-bubble');
    this.bubble.setAttribute('role', 'status');
    this.bubble.setAttribute('aria-live', 'polite');
    const tail = el('div', 'cbx-bubble-tail');
    this.above = el('div', 'cbx-above');
    const bottom = el('div', 'cbx-bottom');
    this.left = el('div', 'cbx-slot-left');
    this.centre = el('div', 'cbx-slot-centre');
    const right = el('div', 'cbx-slot-right');
    bottom.append(this.left, this.centre, right);

    // joystick (bottom centre, walking modes)
    this.stick = el('div', 'cbx-stick pe', '<span></span>');
    this.stick.setAttribute('role', 'application');
    this.stick.setAttribute('aria-label', 'Joystick: walk Cheer Bear');
    this.stick.hidden = true;
    this.stickKnob = this.stick.firstElementChild as HTMLElement;
    this.bindStick();

    this.hudEl.append(top, this.hintEl, this.toastEl, this.bubble, tail, this.above, bottom);
    this.layer = el('div', 'cbx-layer');

    this.coverEl = el('div', 'cbx-cover', `<div>${ICON.heart}<p></p></div>`);
    this.coverEl.setAttribute('role', 'status');
    this.coverText = this.coverEl.querySelector('p')!;
    this.coverText.style.margin = '0';
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
    this.hudEl.hidden = false;
    this.hudEl.classList.add('off');
    requestAnimationFrame(() => this.hudEl.classList.remove('off'));
    window.setTimeout(() => { this.splash.hidden = true; }, 800);
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
    for (const [id, b] of this.switchBtns) {
      b.setAttribute('aria-pressed', String(id === mode));
      b.disabled = busy;
    }
    this.switchEl.classList.toggle('busy', busy);
  }
  setReserved(px: number): void {
    this.root.style.setProperty('--cbx-reserved', Math.max(0, px) + 'px');
  }

  // ------------------------------------------------------------------ HudApi
  hint(text: string): void {
    text = text || '';
    if (text !== this.hintText) {
      this.hintText = text;
      this.hintEl.textContent = text;
    }
  }
  toast(text: string, ms = 1500): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => this.toastEl.classList.remove('on'), ms);
  }
  speech(text: string | null): void {
    if (text && text.trim()) {
      let t = text.trim();
      if (t.length > 160) t = '…' + t.slice(-158).replace(/^\S*\s/, '');
      this.bubble.textContent = t;
      this.bubble.classList.add('on');
    } else this.bubble.classList.remove('on');
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
  shutter(onClick: () => void, aria = 'Take a photo'): HTMLButtonElement {
    const b = el('button', 'cbx-shutter', '<i></i>');
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
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
  cover(text: string | null): void {
    if (text) {
      this.coverText.textContent = text;
      this.coverEl.classList.add('on');
    } else this.coverEl.classList.remove('on');
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
      body: `${what} uses your phone's camera. Scan this to open it there. The 3D view and the call work right here.`,
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
        <li><b>3D</b>: Cheer Bear in Care-a-Lot. Drag to look around, pinch to zoom, the joystick walks her.</li>
        <li><b>AR</b>: point your phone at the floor, tap <b>Place</b>. Walk her into her house to go inside. <b>Move</b> puts it all somewhere else.</li>
        <li><b>Selfie</b> and <b>Photo</b>: the white button takes a picture with her.</li>
        <li>Talk to her! Say <b>house</b>, <b>rainbow</b>, <b>party</b>, <b>magic</b>, <b>dance</b> or <b>sleep</b> and watch what happens.</li>
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
