"""Final clip set, named by the app's BearClip names (src/shared/contracts.ts).

Source clips are picked by what they SHOW, not by their file names: in the Meshy file 'Walking' is a hello-wave,
'Running' is a pointing/presenting gesture and 'Wave_for_Help_4' is arm flapping. Clips that exist nowhere (sleep,
wakeUp, shiver, talkIdle, run) are authored here as rotations about the bear's own axes on top of the idle pose:
+x = her left, +y = up, +z = forward (positive x-rotation tips a bone forward/down).
"""
from __future__ import annotations

import numpy as np

from clips import FPS, Poser, env, make_loop, sample_pose, blend_clips

TAU = 2 * np.pi


def _times(dur):
    return np.linspace(0, dur, int(round(dur * FPS)) + 1)


def _segment(src, t0, t1):
    times, clip = src
    m = (times >= t0) & (times <= t1)
    out = {i: {p: v[m] if len(v) == len(times) else v for p, v in tr.items()} for i, tr in clip.items()}
    return times[m] - times[m][0], out


def _retime(src, factor):
    """Play `src` `factor` times faster (resampled)."""
    times, clip = src
    nt = _times(times[-1] / factor)
    st = nt * factor
    out = {}
    for i, tr in clip.items():
        out[i] = {}
        for p, v in tr.items():
            if len(v) != len(times):
                out[i][p] = v
                continue
            r = np.stack([np.interp(st, times, v[:, k]) for k in range(v.shape[1])], -1)
            if p == 'rotation':
                r /= np.linalg.norm(r, axis=1, keepdims=True)
            out[i][p] = r
    return nt, out


def _sleep_pose(P: Poser, w):
    P.rot('Head', [1, 0, 0], 0.5 * w).rot('Head', [0, 0, 1], 0.26 * w)
    P.rot('Neck', [1, 0, 0], 0.25 * w)
    P.rot('Spine2', [1, 0, 0], 0.1 * w).rot('Spine1', [1, 0, 0], 0.06 * w)
    P.rot('LeftArm', [0, 0, 1], -0.12 * w).rot('RightArm', [0, 0, 1], 0.12 * w)
    P.rot('LeftShoulder', [0, 0, 1], -0.06 * w).rot('RightShoulder', [0, 0, 1], 0.06 * w)


def author_clips(dst, have, log):
    it, idle = have['idle']
    base = sample_pose(it, idle, 0.0)
    out = {}

    out['idle'] = have['idle']

    # talkIdle: idle stance, easy two-handed "explaining" gestures and a light sway (the Bear adds speech-driven
    # head bob on top while she talks).
    t = _times(4.0)
    P = Poser(dst, t, base)
    g1 = 0.5 - 0.5 * np.cos(TAU * t / 4.0)
    g2 = 0.5 - 0.5 * np.cos(TAU * (t / 4.0 + 0.5))
    P.rot('RightArm', [1, 0, 0], -0.35 * g1).rot('RightForeArm', [0, 1, 0], 0.55 * g1)
    P.rot('LeftArm', [1, 0, 0], -0.28 * g2).rot('LeftForeArm', [0, 1, 0], -0.45 * g2)
    P.rot('Spine2', [0, 1, 0], 0.05 * np.sin(TAU * t / 4.0)).rot('Spine1', [0, 0, 1], 0.025 * np.sin(TAU * t / 2.0))
    P.rot('Head', [0, 0, 1], 0.05 * np.sin(TAU * t / 4.0 + 1.0))
    out['talkIdle'] = (t, P.clip())

    # wave: the Meshy 'Walking' clip is a friendly hello-wave.
    out['wave'] = have.get('meshy_Walking', have['idle'])
    out['walk'] = have['walk']

    # run: the walk cycle, faster, leaning in, arms pumping a bit more.
    rt, rc = _retime(have['walk'], 1.65)
    P = Poser(dst, rt, rc)
    P.rot('Spine', [1, 0, 0], 0.16).rot('Head', [1, 0, 0], -0.12)
    P.rot('LeftForeArm', [1, 0, 0], -0.5).rot('RightForeArm', [1, 0, 0], -0.5)
    c = P.clip()
    c[dst.root_joint]['translation'] = rc[dst.root_joint]['translation']
    out['run'] = (rt, c)

    out['dance'] = have.get('dance', have['idle'])
    out['danceSmall'] = have.get('meshy_Joyful_Dance_with_Hand_Sway', have['idle'])
    # cheer: the arms-up stretch of the long idle.
    out['cheer'] = _segment(have['CB_Idle_9'], 5.2, 10.8) if 'CB_Idle_9' in have else have['idle']
    out['sway'] = have.get('meshy_Happy_Sway_Standing', have['idle'])
    out['present'] = have.get('meshy_Running', have['idle'])

    # sleep: head drooped, slow breathing (loops, 4 s).
    t = _times(4.0)
    P = Poser(dst, t, base)
    _sleep_pose(P, 1.0)
    br = np.sin(TAU * t / 4.0)
    P.rot('Spine2', [1, 0, 0], -0.035 * br).rot('Head', [1, 0, 0], 0.03 * br)
    P.rot('LeftArm', [0, 0, 1], 0.03 * br).rot('RightArm', [0, 0, 1], -0.03 * br)
    out['sleep'] = (t, P.clip())

    # wakeUp: from the sleep pose, a big stretch (arms up, head back), then settle into idle (2.8 s, once).
    t = _times(2.8)
    P = Poser(dst, t, base)
    _sleep_pose(P, env(t, [(0, 1), (0.9, 0)]))
    s = env(t, [(0.5, 0), (1.25, 1), (1.7, 1), (2.6, 0)])
    P.rot('LeftArm', [0, 0, 1], 2.0 * s).rot('RightArm', [0, 0, 1], -2.0 * s)
    P.rot('LeftForeArm', [0, 0, 1], 0.35 * s).rot('RightForeArm', [0, 0, 1], -0.35 * s)
    P.rot('Spine2', [1, 0, 0], -0.16 * s).rot('Head', [1, 0, 0], -0.3 * s).rot('Neck', [1, 0, 0], -0.1 * s)
    wob = env(t, [(1.25, 0), (1.45, 1), (1.7, 0)]) * np.sin(TAU * 3 * t)
    P.rot('Head', [0, 0, 1], 0.06 * wob)
    out['wakeUp'] = (t, P.clip())

    # shiver: hug yourself and tremble (2.6 s, once).
    t = _times(2.6)
    P = Poser(dst, t, base)
    h = env(t, [(0, 0), (0.35, 1), (2.1, 1), (2.6, 0)])
    P.rot('LeftShoulder', [0, 0, 1], 0.14 * h).rot('RightShoulder', [0, 0, 1], -0.14 * h)
    P.rot('LeftArm', [1, 0, 0], -0.75 * h).rot('RightArm', [1, 0, 0], -0.75 * h)
    P.rot('LeftArm', [0, 0, 1], -0.2 * h).rot('RightArm', [0, 0, 1], 0.2 * h)
    P.rot('LeftForeArm', [0, 1, 0], -1.15 * h).rot('RightForeArm', [0, 1, 0], 1.15 * h)
    P.rot('Head', [1, 0, 0], 0.12 * h).rot('Neck', [1, 0, 0], 0.06 * h)
    jit = h * (np.sin(TAU * 9 * t) + 0.5 * np.sin(TAU * 13.3 * t + 1.3))
    P.rot('Spine2', [0, 1, 0], 0.035 * jit).rot('Spine1', [0, 0, 1], 0.02 * jit)
    P.rot('Head', [0, 0, 1], 0.03 * h * np.sin(TAU * 11 * t + 0.7))
    P.rot('LeftArm', [0, 1, 0], 0.03 * jit).rot('RightArm', [0, 1, 0], -0.03 * jit)
    out['shiver'] = (t, P.clip())

    # extras the scenes may want
    for k, src in (('backflip', 'backflip'), ('sad', 'sad'), ('angry', 'angry'), ('flap', 'meshy_Wave_for_Help_4')):
        if src in have:
            out[k] = have[src]
    return out
