# Lip sync

Cheer Bear's mouth is driven only by the audio she speaks. No text, no phoneme timings, no paid service, no added
latency: every rendered frame looks at the last ~21 ms of audio and moves the mouth toward what it hears.

Code: `src/lipsync/` (engine), `src/audio/context.ts` (the one shared AudioContext), `src/bear/face.ts` (how viseme
weights become blend shapes and jaw). Test page: `/lab/lipsync` (dev: `lipsync-lab.html`).

## Using it

You normally never touch the engine: the `Bear` owns one.

```ts
import { loadBear, unlockAudio } from '@/bear';
const bear = await loadBear();
// in a tap / click (iOS needs this once before any audio works):
unlockAudio();
// a call: analyse Cheer Bear's remote WebRTC stream (it is NOT played again; Twilio already plays it)
bear.setSpeechStream(remoteStream);   // null to stop
// a clip: plays it through the shared context and lip-syncs it
await bear.say('/media/voice/hello.mp3');
// pre-computed visemes (any rate, they are eased): bear.setVisemes(frame) / bear.setVisemes(null)
// tuning: bear.lipSync.setConfig({ intensity: 1.2 })  or  loadBear({ lipSync: { intensity: 1.2 } })
```

Other sources: `bear.lipSync.attachNode(node)` analyses any node in the shared graph (for example
`mediaElementSource(audioEl)` from `src/lipsync/sources.ts`; remember an element routed into Web Audio is only heard
if that node is also connected to `getAudioContext().destination`).

### Rules that keep iOS and calls working

- ONE AudioContext for the whole app: `getAudioContext()` from `src/audio/context.ts`. Never `new AudioContext()`.
- Call `unlockAudio()` inside a user gesture (the talk button, the first tap). It resumes the context and plays one
  silent sample. After an iOS interruption (call, backgrounding) the next gesture that calls it resumes again.
- A remote WebRTC stream is analysed, never played by us. `setSpeechStream` also attaches the stream to a muted,
  hidden `<audio>`: Chrome/Android deliver silence to Web Audio from a remote stream unless an element holds it.
- The analyser is pulled through a gain of 0 into the destination (an analyser that nothing pulls may not run).
- The phone-quality render in the lab uses an `OfflineAudioContext` (8 kHz), which does not count as a live context.

## How it works

Per rendered frame (`LipSyncEngine.update(dt)`), from one `AnalyserNode` (FFT 1024, no smoothing):

1. **Level, noise floor, gate.** RMS level in dBFS. The floor falls instantly to quieter levels and rises slowly
   (faster while nobody talks). Speech opens `gateOpenDb` above the floor and closes below `gateCloseDb`, after
   `gateHoldMs`. Outside speech every target is 0, so the mouth closes in silence.
2. **Loudness (auto gain).** 1 at the recent peak (which decays 4 dB/s), 0 at `dynamicRangeDb` below it, with a
   `loudnessGamma` curve. Quiet and loud speakers, and phone vs. full-band audio, all use the whole range.
3. **Formants (vowels).** The frame is decimated to ~11-12 kHz, pre-emphasised, windowed, and an order-12 LPC model is
   fitted (Levinson-Durbin). F1 and F2 are the first peaks of the all-pole envelope (F1 in 250-1100 Hz, F2 above it up
   to 3.2 kHz). When F1 and F2 of a back vowel merge into one peak (the next peak is then a weak F3), F2 is taken as
   1.45 x F1. This is robust to the strong first harmonic of a high voice and to the 300 Hz high-pass of a phone line,
   which a spectral-centroid estimate is not (that was the first version, and it called every vowel "O/U").
4. **Vowel classification.** Smoothed log-F1/log-F2 is compared against 12 vowel prototypes (Peterson & Barney /
   Hillenbrand female averages: father, cup, cat -> `aa`; bed, bait -> `E`; beet, bit -> `I`; bought, boat -> `O`;
   boot, book -> `U`; bird -> `RR`) with Gaussian weights (width set by `vowelSharpness`). A slow estimate of the
   speaker's average formants shifts the map by up to 15% (`speakerAdaptSec`), so deeper or brighter voices still land.
   The vowel amount is the loudness, minus whatever is taken by consonants.
5. **Consonants, all phone-safe.**
   - Fricatives: energy tilted up (1.8-3.4 kHz vs 150-900 Hz, plus 4.5-8 kHz when the audio has it) and aperiodic
     (low autocorrelation voicing), and only when there is real energy above the floor. S vs SH: with energy above
     4.5 kHz, S is the one that has most of it; on a phone line that band is gone, so SH is guessed softly from where
     the 1.8-3.4 kHz energy sits (blended, never a hard switch). Quiet and spectrally flat frication is F/V/TH (`FF`).
   - Closures (P, B, M): a dip of more than ~0.6 x `closureDipDb` below the syllable peak inside speech presses the
     lips (`PP`). A real stop closure lasts 50-120 ms, so a longer dip (a phrase ending) fades back to rest after
     ~150 ms instead of holding a press. Nasal murmur (voiced, quiet, low-frequency) adds `nn`.
   - Bursts (T, D, K): a fast, aperiodic onset right after a closure; `DD` when the following vowel is front, else `kk`.
6. **Motion.** Each viseme follows its target with an exact critically damped spring (`attackMs` rising, `releaseMs`
   falling): no overshoot, no jitter, stable at any frame rate, and neighbouring sounds blend (coarticulation). The
   jaw/loudness envelope has its own `jawMs`. Caps: `maxViseme` per shape, `maxTotal` for the sum.

The Bear turns the weights into the face (`src/bear/face.ts`): each `viseme_*` blend shape holds the LIP shape only;
the jaw is one channel, `jawOpen = sum(weight_v x jaw_v)` with each viseme's jaw share from the model
(`viseme_recipes.json`: aa 0.62, O 0.42, E 0.34, ... PP 0). Expressions keep only part of their mouth while she talks,
so visemes read clearly. The body adds small speech-driven head nods and sway, and switches idle to `talkIdle` after
half a second of speech.

Latency: one analysis window (21 ms at 48 kHz) plus the attack spring (~55 ms to fully reach a shape, visibly moving
within a frame). Nothing is buffered or delayed. CPU: one 1024-point FFT (done by the browser), an order-12 LPC and a
pitch autocorrelation per frame; well under a millisecond on a phone.

## Config (`LipSyncConfig`, `src/lipsync/config.ts`)

One typed object. Defaults are `DEFAULT_LIPSYNC_CONFIG`; slider ranges are `LIPSYNC_CONFIG_RANGES` (the lab uses
them; an admin panel can too). Change live with `bear.lipSync.setConfig(patch)`.

| key | default | range | what it does |
| --- | --- | --- | --- |
| `fftSize` | 1024 | 512 / 1024 / 2048 | Analysis window. 1024 at 48 kHz = 21 ms: enough for formants, low latency. |
| `bandTopHz` | 3400 | 2400-8000 | Top of the band used for vowel and consonant cues. 3400 keeps it identical on a phone line. |
| `gateOpenDb` | 9 | 3-24 | Speech starts this many dB above the tracked noise floor. Raise for noisy calls. |
| `gateCloseDb` | 5 | 1-20 | ...and stops below floor + this. Keep below `gateOpenDb`. |
| `gateHoldMs` | 140 | 0-400 | Keeps the gate open through short stops inside words. |
| `floorMinDb` | -75 | -100 to -40 | Lowest noise floor assumed (digital silence sits far below). |
| `floorRiseDbPerSec` | 2.5 | 0.5-10 | How fast the floor follows a louder background (it falls instantly). |
| `dynamicRangeDb` | 26 | 10-45 | Loudness window below the recent peak. Smaller = mouth opens wide more often. |
| `loudnessGamma` | 0.8 | 0.4-1.6 | Curve on loudness (<1 opens earlier on quiet syllables). |
| `intensity` | 1 | 0.3-1.5 | Overall mouth size (every viseme and the jaw envelope). |
| `vowelSharpness` | 1 | 0.3-3 | How hard the vowel classifier commits (higher = crisper vowels, lower = more blended). |
| `speakerAdaptSec` | 6 | 1-20 | Seconds of speech over which the speaker's average formants are learned. |
| `fricativeGain` | 0.8 | 0-1.5 | Weight of S / SH / F shapes. 0 disables. |
| `closureGain` | 0.9 | 0-1.5 | Weight of P / B / M lip closures (and nasal `nn`). 0 disables. |
| `closureDipDb` | 10 | 3-24 | Dip below the syllable peak that counts as a closure (60% of it starts, 120% is full). |
| `burstGain` | 0.5 | 0-1.5 | Weight of T / D / K release flicks. |
| `attackMs` | 55 | 15-200 | Time to reach a new shape. Lower = snappier, higher = softer. |
| `releaseMs` | 95 | 20-300 | Time to relax out of a shape (a bit slower than attack reads as natural). |
| `jawMs` | 60 | 15-200 | Time constant of the loudness / jaw envelope. |
| `maxViseme` | 1 | 0.3-1 | Cap on any single viseme. The new shapes are clean at 1.0, so no cap is needed for safety. |
| `maxTotal` | 1 | 0.5-1.5 | Cap on the sum of visemes, so shapes blend instead of stacking. |

Tuning tips: if she mumbles, raise `intensity` or lower `dynamicRangeDb`; if she flaps on line noise, raise
`gateOpenDb`; if vowels look samey, raise `vowelSharpness`; if consonants look busy, lower `fricativeGain` /
`burstGain`; for a softer, more "animated character" feel raise `attackMs` to ~80 and `releaseMs` to ~130.

## The lab (`/lab/lipsync`)

- Inputs: the sample voice, three synthetic scripts (vowel sweep, syllables ba-ma-sa-sha-fa, a short phrase; made by
  `src/bear/lab/synth.ts`, a small Klatt-style formant synthesiser, nothing recorded), your own file, the microphone
  (analysed through the exact call path, never played back). "Phone quality" renders files at 8 kHz, 300-3400 Hz,
  mu-law (OfflineAudioContext), and puts the mic through a live 300-3400 Hz band-pass + mu-law chain.
- Live bars for every viseme, loudness, gate, level/floor, F1/F2, voicing, fricative/closure, band.
- Shape test: ramps every blend shape (and the eyelid rig) to 1.0 one at a time; "Sweep visemes" does the same
  through the real viseme path (lips + jaw). A dropdown holds any one shape at 1.0.
- Every tuning value as a slider, with Reset and Copy JSON (paste into `loadBear({ lipSync })` or the admin config).
- Body clips, expressions, face/full-body camera, eyes follow the pointer.
- `window.__lab` hooks (`playSample(phone)`, `playSynth(name, phone)`, `shape(name, w)`, `sweep(kind)`, `camera(m)`,
  `bear()`) exist for headless evidence capture.

## Known limits

- Audio-only lip sync infers, it does not know phonemes: S vs SH on a phone line is a soft guess, and F vs P is
  sometimes swapped (both close the lips). It reads as natural at conversational speed; it is not phonetically exact.
- Vowel prototypes are adult female English. The speaker shift covers other voices within about 15%; a child or a
  very deep voice may lean toward one side of the vowel map.
- Verified on synthetic speech and the one sample clip, full band and phone band, in headless Chromium. Not yet
  watched on a real Twilio call, on an iPhone, or with background noise (see `docs/handoff/bear-lipsync.md`).
