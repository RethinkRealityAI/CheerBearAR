// What the built-in modes (showcase, AR) share beyond the public ModeContext: the full HUD, the videos, the bear and
// a way to report a tap-triggered action. Face/photo modes use ModeContext only (src/experience/types.ts).
import type { BearCharacter } from '../../shared/contracts';
import type { Hud } from '../hud/hud';
import type { Media } from '../scene/media';
import type { ModeContext } from '../types';

export interface Shared {
  ctx: ModeContext;
  hud: Hud;
  media: Media;
  reduced: boolean;
  container: HTMLElement;
  bear(): BearCharacter | null;
  /** A moment started from a tap on the scene (emits `action` with source 'tap'). */
  tapAction(name: string): void;
}

/** Pointer helper: taps (short, still), one-finger drags and two-finger pinches on an element. */
export interface Gestures {
  onTap?(x: number, y: number): void;
  onDrag?(dx: number, dy: number): void;
  /** Pinch ratio since the last call (> 1 = fingers apart). */
  onPinch?(ratio: number): void;
  onWheel?(deltaY: number): void;
}

export function bindGestures(el: HTMLElement, g: Gestures): () => void {
  const pts = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>();
  let pinchD = 0;
  let moved = false;
  const dist = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    if (pts.size === 1) moved = false;
    if (pts.size === 2) { pinchD = dist(); moved = true; }
  };
  const move = (e: PointerEvent) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 2) {
      const d = dist();
      if (pinchD > 0 && d > 0) g.onPinch?.(d / pinchD);
      pinchD = d;
      return;
    }
    if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) moved = true;
    if (moved) g.onDrag?.(dx, dy);
  };
  const up = (e: PointerEvent) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    pts.delete(e.pointerId);
    if (pts.size === 0 && !moved && performance.now() - p.t0 < 450) {
      const r = el.getBoundingClientRect();
      g.onTap?.(e.clientX - r.left, e.clientY - r.top);
    }
    if (pts.size < 2) pinchD = 0;
  };
  const cancel = (e: PointerEvent) => { pts.delete(e.pointerId); moved = true; };
  const wheel = (e: WheelEvent) => { e.preventDefault(); g.onWheel?.(e.deltaY); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('wheel', wheel, { passive: false });
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
    el.removeEventListener('wheel', wheel);
  };
}

/** Arrow keys / WASD as a joystick on computers (x right, y down). */
export function keyStick(): { vector: { x: number; y: number }; dispose(): void } {
  const held = new Set<string>();
  const v = { x: 0, y: 0 };
  const upd = () => {
    v.x = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    v.y = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0);
    const l = Math.hypot(v.x, v.y);
    if (l > 1) { v.x /= l; v.y /= l; }
  };
  const map: Record<string, string> = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  const kd = (e: KeyboardEvent) => {
    const k = map[e.code];
    if (!k || (e.target as HTMLElement)?.closest?.('input,textarea,[contenteditable]')) return;
    held.add(k); upd();
  };
  const ku = (e: KeyboardEvent) => { const k = map[e.code]; if (k) { held.delete(k); upd(); } };
  const blur = () => { held.clear(); upd(); };
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  window.addEventListener('blur', blur);
  return {
    vector: v,
    dispose: () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur); },
  };
}
