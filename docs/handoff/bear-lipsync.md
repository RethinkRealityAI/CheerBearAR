# bear-lipsync handoff (work in progress)

**v0 is live**: `import { loadBear, unlockAudio } from '@/bear'` returns a working `BearCharacter` built on
`public/models/cheer-bear.glb` (currently a copy of the old `care-bear-animated.glb`). Feet on y = 0, facing +z,
1 m tall (`bear.height`). Call `bear.update(dt)` every frame. All `BearClip` names play (some mapped to stand-ins
until the new model lands). The API will stay as-is while the internals and the model file are replaced.

Full write-up follows when the work is done.
