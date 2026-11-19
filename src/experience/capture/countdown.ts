// The visible photo countdown (Selfie: 5 s) and the flat white flash.
import { el } from './ui';

export class Countdown {
  private node: HTMLElement;
  private num: HTMLElement;
  private timer = 0;
  private endAt = 0;
  private last = -1;
  private resolve: ((shot: boolean) => void) | null = null;
  private onTick: ((left: number) => void) | null = null;

  constructor(parent: HTMLElement, private reduced: boolean) {
    this.node = el('div', 'cbc-count' + (reduced ? ' reduced' : ''), '<span></span><small>Tap again to shoot now</small>');
    this.node.setAttribute('role', 'timer');
    this.node.setAttribute('aria-live', 'assertive');
    this.node.hidden = true;
    this.num = this.node.firstElementChild as HTMLElement;
    parent.appendChild(this.node);
  }

  get running(): boolean {
    return !!this.resolve;
  }

  /** Resolves true when it reaches zero (or `now()` was called), false if cancelled. `tick` gets seconds left. */
  start(seconds: number, tick?: (left: number) => void): Promise<boolean> {
    this.cancel();
    this.onTick = tick ?? null;
    this.endAt = performance.now() + seconds * 1000;
    this.last = -1;
    this.node.hidden = false;
    const p = new Promise<boolean>((r) => { this.resolve = r; });
    const step = () => {
      const left = Math.max(0, (this.endAt - performance.now()) / 1000);
      const n = Math.ceil(left);
      if (n !== this.last && n > 0) {
        this.last = n;
        this.num.textContent = String(n);
        if (!this.reduced) {
          this.num.classList.remove('pop');
          void this.num.offsetWidth; // restart the pop
          this.num.classList.add('pop');
        }
      }
      this.onTick?.(left);
      if (left <= 0) return this.finish(true);
      this.timer = window.setTimeout(step, 50);
    };
    step();
    return p;
  }

  /** Shoot now (second tap on the shutter). */
  now(): void {
    if (this.resolve) this.finish(true);
  }

  cancel(): void {
    if (this.resolve) this.finish(false);
  }

  private finish(shot: boolean): void {
    clearTimeout(this.timer);
    this.node.hidden = true;
    const r = this.resolve;
    this.resolve = null;
    this.onTick = null;
    r?.(shot);
  }

  dispose(): void {
    this.cancel();
    this.node.remove();
  }
}

/** A short flat white flash over everything (softer and longer-faded under reduced motion, never a hard blink). */
export function flash(container: HTMLElement, reduced: boolean): void {
  const f = el('div', 'cbc-flash');
  container.appendChild(f);
  requestAnimationFrame(() => {
    f.style.opacity = reduced ? '0.35' : '0.9';
    window.setTimeout(() => {
      f.style.transition = `opacity ${reduced ? 0.5 : 0.28}s ease-out`;
      f.style.opacity = '0';
      window.setTimeout(() => f.remove(), reduced ? 600 : 400);
    }, reduced ? 120 : 70);
  });
}
