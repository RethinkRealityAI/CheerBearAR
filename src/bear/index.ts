// Entry point of the character module (see src/shared/contracts.ts).
//
//   import { loadBear, unlockAudio } from '@/bear';
//   const bear = await loadBear({ onProgress: p => ... });
//   scene.add(bear.object);  // feet on y = 0, facing +z, bear.height metres tall
//   renderer.setAnimationLoop(() => { bear.update(clock.getDelta()); renderer.render(scene, camera); });
//   // in a tap:   unlockAudio();
//   // on a call:  bear.setSpeechStream(remoteStream);
import type { BearCharacter } from '../shared/contracts';
import { Bear, type LoadBearOptions } from './Bear';

export { unlockAudio } from '../audio/context';
export type { LoadBearOptions } from './Bear';
export { Bear } from './Bear';

/** URL of the one Cheer Bear model used everywhere. */
export const BEAR_MODEL_URL = '/models/cheer-bear.glb';

/** Load Cheer Bear. Resolves with a ready character (body idle playing, face alive). */
export function loadBear(opts?: LoadBearOptions): Promise<BearCharacter> {
  return Bear.load(opts);
}
