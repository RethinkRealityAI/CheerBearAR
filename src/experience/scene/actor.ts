// Cheer Bear on a stage: where she stands, which way she faces, walking/running from the joystick and scripted moves
// for the moments. Uses only the BearCharacter contract (play, whenClipDone, setExpression, lookAt, update).
import * as THREE from 'three';
import type { BearCharacter, BearClip, BearExpression } from '../../shared/contracts';
import { angleTo, damp } from '../core/timeline';

export const WALK_SPEED = 0.75; // stage units (bear heights) per second
export const RUN_SPEED = 1.7;

export class Actor {
  /** Feet on the stage floor; rotation.y = heading (0 = facing +z). The bear is normalised to 1 unit tall inside. */
  readonly holder = new THREE.Group();
  bear: BearCharacter | null = null;
  heading = 0;
  /** > 0 while a moment drives her (the joystick waits). */
  scripted = 0;
  asleep = false;
  moving = 0; // 0..1 smoothed stick magnitude
  private loop: BearClip = 'idle';
  private onceUntil = 0;
  private gait: 'idle' | 'walk' | 'run' = 'idle';
  private tmp = new THREE.Vector3();

  constructor(name: string) {
    this.holder.name = name;
  }

  attach(bear: BearCharacter): void {
    this.bear = bear;
    const o = bear.object;
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    o.scale.setScalar(1 / (bear.height || 1));
    o.userData.cbxOwnGpu = !!bear.releaseRenderer;
    this.holder.add(o);
    this.gait = 'idle';
    bear.play(this.asleep ? 'sleep' : 'idle', { fade: 0.2 });
    this.loop = this.asleep ? 'sleep' : 'idle';
  }
  detach(): void {
    if (this.bear && this.bear.object.parent === this.holder) this.holder.remove(this.bear.object);
    this.bear = null;
  }
  get attached(): boolean {
    return !!this.bear && this.bear.object.parent === this.holder;
  }

  get position(): THREE.Vector3 {
    return this.holder.position;
  }

  /** Switch the looping clip (only on change: re-playing every frame restarts cross-fades). */
  setLoop(clip: BearClip, fade = 0.3): void {
    if (!this.bear) return;
    if (clip === this.loop && performance.now() > this.onceUntil) return;
    this.loop = clip;
    this.onceUntil = 0;
    this.bear.play(clip, { fade });
  }
  get loopClip(): BearClip {
    return this.loop;
  }

  /** Play a clip once; resolves when it is done (or after maxS as a fallback). */
  once(clip: BearClip, maxS = 4, speed = 1): Promise<void> {
    if (!this.bear) return Promise.resolve();
    this.bear.play(clip, { once: true, fade: 0.25, speed });
    this.onceUntil = performance.now() + maxS * 1000;
    const done = this.bear.whenClipDone();
    return Promise.race([done, new Promise<void>((r) => window.setTimeout(r, maxS * 1000))]).then(() => {
      this.onceUntil = 0;
    });
  }

  face(e: BearExpression, hold?: number): void {
    this.bear?.setExpression(e, hold ? { hold } : undefined);
  }

  /** Turn towards a yaw smoothly. */
  turnTo(yaw: number, dt: number, rate = 8): void {
    this.heading += angleTo(this.heading, yaw) * damp(rate, dt);
    this.holder.rotation.y = this.heading;
  }
  /** Turn towards a point (stage-local). */
  turnToPoint(p: THREE.Vector3, dt: number, rate = 8): void {
    const dx = p.x - this.holder.position.x, dz = p.z - this.holder.position.z;
    if (dx * dx + dz * dz > 1e-6) this.turnTo(Math.atan2(dx, dz), dt, rate);
  }
  setHeading(yaw: number): void {
    this.heading = yaw;
    this.holder.rotation.y = yaw;
  }

  /**
   * Joystick locomotion. `dir` is a stage-local XZ direction with length 0..1 (stick magnitude).
   * `constrain` keeps her inside the play area / out of the house. Returns true while she moves.
   */
  drive(dir: THREE.Vector3, dt: number, constrain?: (p: THREE.Vector3) => void): boolean {
    const mag = Math.min(1, dir.length());
    this.moving += (mag - this.moving) * damp(10, dt);
    if (this.scripted > 0) return false;
    if (mag < 0.08) {
      if (this.gait !== 'idle') {
        this.gait = 'idle';
        this.setLoop(this.asleep ? 'sleep' : 'idle', 0.25);
      }
      return false;
    }
    const run = mag > 0.72;
    const want = run ? 'run' : 'walk';
    if (this.gait !== want) {
      this.gait = want;
      this.setLoop(want, 0.2);
    }
    const sp = (run ? RUN_SPEED : WALK_SPEED) * (run ? 1 : 0.55 + 0.6 * mag) * dt;
    this.tmp.copy(dir).setY(0).normalize();
    this.holder.position.addScaledVector(this.tmp, sp);
    constrain?.(this.holder.position);
    this.turnTo(Math.atan2(this.tmp.x, this.tmp.z), dt, 12);
    return true;
  }

  get walking(): boolean {
    return this.gait !== 'idle';
  }
  /** Back to the plain standing loop (after a moment). */
  settle(): void {
    this.gait = 'idle';
    this.setLoop(this.asleep ? 'sleep' : 'idle', 0.35);
  }

  update(dt: number, lookAt: THREE.Vector3 | null): void {
    const b = this.bear;
    if (!b) return;
    b.lookAt(this.asleep || this.walking || this.scripted ? null : lookAt);
    // talking while standing: the chatty idle (only switches on change)
    if (!this.asleep && !this.walking && !this.scripted && performance.now() > this.onceUntil) {
      const want: BearClip = b.speaking ? 'talkIdle' : 'idle';
      if ((this.loop === 'idle' || this.loop === 'talkIdle') && this.loop !== want) this.setLoop(want, 0.4);
    }
    b.update(dt);
  }
}
