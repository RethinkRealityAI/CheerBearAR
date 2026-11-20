"""Body clips for cheer-bear.glb: native clips, Meshy clips retargeted onto this skeleton, and authored clips.

A clip here is {node_index: {'rotation': (times, quats xyzw), 'translation': (times, xyz)}} in the body's glTF node
space. Every output clip gets a rotation track for every body bone and a Hips translation track, so cross-fading
between clips never leaves a bone where a previous clip put it.
"""
from __future__ import annotations

import numpy as np

from gltf_io import Glb, quat_mul, quat_inv, quat_axis_angle, quat_rotate, quat_continuity, quat_to_mat, mat_to_quat

FPS = 30

# Meshy rig bone -> Mixamo bone on our bear
MESHY_MAP = {
    'Hips': 'Hips', 'Spine02': 'Spine', 'Spine01': 'Spine1', 'Spine': 'Spine2', 'neck': 'Neck', 'Head': 'Head',
    'head_end': 'HeadTop_End',
    'LeftShoulder': 'LeftShoulder', 'LeftArm': 'LeftArm', 'LeftForeArm': 'LeftForeArm', 'LeftHand': 'LeftHand',
    'RightShoulder': 'RightShoulder', 'RightArm': 'RightArm', 'RightForeArm': 'RightForeArm', 'RightHand': 'RightHand',
    'LeftUpLeg': 'LeftUpLeg', 'LeftLeg': 'LeftLeg', 'LeftFoot': 'LeftFoot', 'LeftToeBase': 'LeftToeBase',
    'RightUpLeg': 'RightUpLeg', 'RightLeg': 'RightLeg', 'RightFoot': 'RightFoot', 'RightToeBase': 'RightToeBase',
}


class Skeleton:
    """Rest pose + parent table of one glTF file's skin, with rotation-only FK."""

    def __init__(self, g: Glb, prefix: str = ''):
        j = g.json
        self.g = g
        self.j = j
        self.joints: list[int] = j['skins'][0]['joints']
        self.parent: dict[int, int] = {}
        for i, n in enumerate(j['nodes']):
            for c in n.get('children', []):
                self.parent[c] = i
        self.name_to_node = {n.get('name'): i for i, n in enumerate(j['nodes'])}
        self.prefix = prefix
        self.rest_q = {i: np.array(n.get('rotation', [0, 0, 0, 1]), float) for i, n in enumerate(j['nodes'])}
        self.rest_t = {i: np.array(n.get('translation', [0, 0, 0]), float) for i, n in enumerate(j['nodes'])}
        self.rest_s = {i: np.array(n.get('scale', [1, 1, 1]), float) for i, n in enumerate(j['nodes'])}
        # topological order of joints
        order = []
        seen = set()

        def visit(i):
            if i in seen:
                return
            if i in self.parent and self.parent[i] in self.joints:
                visit(self.parent[i])
            seen.add(i)
            order.append(i)
        for i in self.joints:
            visit(i)
        self.order = order
        # world transform of the skeleton root's ancestors (non-joint nodes above Hips)
        self.root_joint = [i for i in self.joints if self.parent.get(i) not in self.joints][0]

    def node(self, name: str) -> int:
        return self.name_to_node[self.prefix + name]

    def ancestor_world(self, i: int):
        """World rotation (quat) and full matrix of the non-joint ancestors of joint i."""
        m = np.eye(4)
        chain = []
        p = self.parent.get(i)
        while p is not None:
            chain.append(p)
            p = self.parent.get(p)
        for p in reversed(chain):
            n = self.j['nodes'][p]
            from gltf_io import trs_to_mat
            m = m @ trs_to_mat(n.get('translation'), n.get('rotation'), n.get('scale'))
        return m

    def fk_rot(self, local: dict[int, np.ndarray]) -> dict[int, np.ndarray]:
        """local: node -> quats (T,4) (missing -> rest). Returns world quats (T,4) for all joints (scale ignored)."""
        T = next(iter(local.values())).shape[0]
        root_m = self.ancestor_world(self.root_joint)
        root_q = mat_to_quat(root_m[:3, :3] / np.linalg.norm(root_m[:3, 0]))
        world = {}
        for i in self.order:
            lq = local.get(i)
            if lq is None:
                lq = np.broadcast_to(self.rest_q[i], (T, 4))
            pw = world[self.parent[i]] if self.parent.get(i) in world else np.broadcast_to(root_q, (T, 4))
            world[i] = quat_mul(pw, lq)
        return world

    def fk_pos(self, local_q: dict[int, np.ndarray], local_t: dict[int, np.ndarray]) -> dict[int, np.ndarray]:
        """World positions (T,3) for all joints."""
        T = next(iter(local_q.values())).shape[0]
        root_m = self.ancestor_world(self.root_joint)
        sc = np.linalg.norm(root_m[:3, 0])
        root_q = mat_to_quat(root_m[:3, :3] / sc)
        wq = {}
        wp = {}
        ws = {}
        for i in self.order:
            lq = local_q.get(i, np.broadcast_to(self.rest_q[i], (T, 4)))
            lt = local_t.get(i, np.broadcast_to(self.rest_t[i], (T, 3)))
            p = self.parent.get(i)
            if p in wq:
                wq[i] = quat_mul(wq[p], lq)
                wp[i] = wp[p] + quat_rotate(wq[p], lt * ws[p])
                ws[i] = ws[p] * self.rest_s[i][0]
            else:
                wq[i] = quat_mul(np.broadcast_to(root_q, (T, 4)), lq)
                wp[i] = root_m[:3, 3] + quat_rotate(np.broadcast_to(root_q, (T, 4)), lt * sc)
                ws[i] = sc * self.rest_s[i][0]
        return wp


def read_clip(g: Glb, anim: dict, fps: int = FPS):
    """Sample a glTF animation at `fps` -> (times, {node: {'rotation': (T,4), 'translation': (T,3)}})."""
    dur = max(float(g.get(s['input']).max()) for s in anim['samplers'])
    n = max(2, int(round(dur * fps)) + 1)
    times = np.linspace(0, dur, n)
    out: dict[int, dict[str, np.ndarray]] = {}
    for ch in anim['channels']:
        path = ch['target']['path']
        if path not in ('rotation', 'translation'):
            continue
        smp = anim['samplers'][ch['sampler']]
        t = g.get(smp['input'])[:, 0]
        v = g.get(smp['output'])
        if smp.get('interpolation', 'LINEAR') == 'CUBICSPLINE':
            v = v.reshape(len(t), 3, -1)[:, 1]
        if path == 'rotation':
            v = quat_continuity(v / np.linalg.norm(v, axis=1, keepdims=True))
            res = np.stack([np.interp(times, t, v[:, k]) for k in range(4)], -1)
            res /= np.linalg.norm(res, axis=1, keepdims=True)
        else:
            res = np.stack([np.interp(times, t, v[:, k]) for k in range(3)], -1)
        out.setdefault(ch['target']['node'], {})[path] = res
    return times, out


def retarget(src: Skeleton, dst: Skeleton, times: np.ndarray, clip: dict, log) -> dict:
    T = len(times)
    s_local_q = {i: v['rotation'] for i, v in clip.items() if 'rotation' in v and i in src.joints}
    s_local_t = {i: v['translation'] for i, v in clip.items() if 'translation' in v and i in src.joints}
    if not s_local_q:
        s_local_q = {src.root_joint: np.broadcast_to(src.rest_q[src.root_joint], (T, 4)).copy()}
    s_world = src.fk_rot(s_local_q)
    one = {src.root_joint: src.rest_q[src.root_joint][None]}
    s_rest_world = {k: v[0] for k, v in src.fk_rot(one).items()}
    s_rest_pos = {k: v[0] for k, v in src.fk_pos(one, {}).items()}
    d_one = {dst.root_joint: dst.rest_q[dst.root_joint][None]}
    d_rest_world = {k: v[0] for k, v in dst.fk_rot(d_one).items()}
    d_rest_pos = {k: v[0] for k, v in dst.fk_pos(d_one, {}).items()}

    m = {src.node(s): dst.node(d) for s, d in MESHY_MAP.items() if (src.prefix + s) in src.name_to_node}
    inv_m = {v: k for k, v in m.items()}

    # Rest alignment per mapped bone: rotate the dst bone (in world) so it points like the src bone at rest.
    align = {}
    for s_i, d_i in m.items():
        s_kids = [c for c in src.j['nodes'][s_i].get('children', []) if c in m]
        # Torso bones point at the spine/neck, not at a leg or a shoulder.
        s_kids.sort(key=lambda c: 0 if any(k in MESHY_MAP.get(src.j['nodes'][c]['name'][len(src.prefix):], '')
                                            for k in ('Spine', 'Neck', 'Head')) else 1)
        if not s_kids:
            align[d_i] = np.array([0, 0, 0, 1.0])
            continue
        sk = s_kids[0]
        dk = m[sk]
        vs = s_rest_pos[sk] - s_rest_pos[s_i]
        vd = d_rest_pos[dk] - d_rest_pos[d_i]
        vs /= np.linalg.norm(vs)
        vd /= np.linalg.norm(vd)
        axis = np.cross(vd, vs)
        ang = np.arccos(np.clip(np.dot(vd, vs), -1, 1))
        align[d_i] = quat_axis_angle(axis, ang) if np.linalg.norm(axis) > 1e-8 else np.array([0, 0, 0, 1.0])

    d_world = {}
    d_local = {}
    root_m = dst.ancestor_world(dst.root_joint)
    root_q = mat_to_quat(root_m[:3, :3] / np.linalg.norm(root_m[:3, 0]))
    for d_i in dst.order:
        p = dst.parent.get(d_i)
        pw = d_world[p] if p in d_world else np.broadcast_to(root_q, (T, 4))
        if d_i in inv_m:
            s_i = inv_m[d_i]
            delta = quat_mul(s_world[s_i], quat_inv(np.broadcast_to(s_rest_world[s_i], (T, 4))))
            w = quat_mul(delta, quat_mul(np.broadcast_to(align[d_i], (T, 4)), np.broadcast_to(d_rest_world[d_i], (T, 4))))
            d_world[d_i] = w
            d_local[d_i] = quat_continuity(quat_mul(quat_inv(pw), w))
        else:
            d_local[d_i] = np.broadcast_to(dst.rest_q[d_i], (T, 4)).copy()
            d_world[d_i] = quat_mul(pw, d_local[d_i])

    out = {i: {'rotation': q} for i, q in d_local.items()}
    # Hips translation: world displacement scaled by hip height, expressed in the Hips' parent space.
    s_h = src.root_joint
    d_h = dst.root_joint
    s_pos = src.fk_pos(s_local_q, s_local_t)[s_h]
    k = (d_rest_pos[d_h][1]) / max(1e-6, s_rest_pos[s_h][1])
    disp = (s_pos - s_rest_pos[s_h]) * k
    pm = root_m[:3, :3]
    local_disp = (np.linalg.inv(pm) @ disp.T).T
    out[d_h]['translation'] = dst.rest_t[d_h] + local_disp
    return out


# ------------------------------------------------------------------ authoring helpers
class Poser:
    """Edit a clip by rotating bones about WORLD (bear) axes: +x = bear's left, +y = up, +z = forward."""

    def __init__(self, skel: Skeleton, times: np.ndarray, base: dict):
        self.s = skel
        self.t = times
        T = len(times)
        self.q = {i: np.broadcast_to(base.get(i, {}).get('rotation', skel.rest_q[i][None]), (T, 4)).copy()
                  for i in skel.joints}
        hips = skel.root_joint
        self.hip_t = np.broadcast_to(base.get(hips, {}).get('translation', skel.rest_t[hips][None]), (T, 3)).copy()

    def world(self):
        return self.s.fk_rot(self.q)

    def rot(self, bone: str, axis, angle):
        """angle: scalar or (T,) radians, about a world axis."""
        i = self.s.node(bone)
        ang = np.broadcast_to(np.asarray(angle, float), (len(self.t),))
        W = self.world()
        p = self.s.parent[i]
        pw = W[p] if p in W else quat_mul(W[i], quat_inv(self.q[i]))
        R = quat_axis_angle(np.asarray(axis, float), ang)
        self.q[i] = quat_mul(quat_mul(quat_mul(quat_inv(pw), R), pw), self.q[i])
        return self

    def clip(self) -> dict:
        out = {i: {'rotation': quat_continuity(q / np.linalg.norm(q, axis=1, keepdims=True))} for i, q in self.q.items()}
        out[self.s.root_joint]['translation'] = self.hip_t
        return out


def ease(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def env(t, keys):
    """Piecewise smooth envelope through (time, value) keys."""
    ks = sorted(keys)
    out = np.full_like(t, ks[0][1], dtype=float)
    for (t0, v0), (t1, v1) in zip(ks, ks[1:]):
        m = (t >= t0) & (t <= t1)
        out[m] = v0 + (v1 - v0) * ease((t[m] - t0) / max(1e-6, t1 - t0))
    out[t > ks[-1][0]] = ks[-1][1]
    return out


def sample_pose(times_src, clip, at: float) -> dict:
    k = int(np.argmin(np.abs(times_src - at)))
    return {i: {p: v[k:k + 1] for p, v in tr.items()} for i, tr in clip.items()}


def blend_clips(a: dict, b: dict, w: np.ndarray) -> dict:
    """Per-frame slerp-ish blend (nlerp) of two equal-length clips; w=0 -> a, 1 -> b."""
    out = {}
    for i in set(a) | set(b):
        out[i] = {}
        for p in ('rotation', 'translation'):
            va = a.get(i, {}).get(p)
            vb = b.get(i, {}).get(p)
            if va is None or vb is None:
                if va is not None or vb is not None:
                    out[i][p] = va if va is not None else vb
                continue
            T = max(len(va), len(vb))
            va = np.broadcast_to(va, (T, va.shape[1]))
            vb = np.broadcast_to(vb, (T, vb.shape[1]))
            ww = w[:, None]
            if p == 'rotation':
                vb2 = np.where((va * vb).sum(1, keepdims=True) < 0, -vb, vb)
                r = va * (1 - ww) + vb2 * ww
                out[i][p] = r / np.linalg.norm(r, axis=1, keepdims=True)
            else:
                out[i][p] = va * (1 - ww) + vb * ww
    return out


# ------------------------------------------------------------------ keyframe reduction + writing
def reduce_keys(t: np.ndarray, v: np.ndarray, tol: float) -> np.ndarray:
    """Douglas-Peucker on a vector time series; returns kept indices."""
    keep = np.zeros(len(t), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(t) - 1)]
    while stack:
        i, j = stack.pop()
        if j - i < 2:
            continue
        a = (t[i + 1:j] - t[i]) / (t[j] - t[i])
        interp = v[i] + (v[j] - v[i]) * a[:, None]
        err = np.abs(v[i + 1:j] - interp).max(1)
        k = int(np.argmax(err))
        if err[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack += [(i, m), (m, j)]
    return np.nonzero(keep)[0]


def write_clip(g: Glb, name: str, times: np.ndarray, clip: dict, bones: list[int], hips: int, rest_q, rest_t):
    channels = []
    samplers = []
    time_cache: dict[bytes, int] = {}

    def times_acc(tt):
        key = tt.astype(np.float32).tobytes()
        if key not in time_cache:
            time_cache[key] = g.add_accessor(tt.astype(np.float32).reshape(-1, 1))
        return time_cache[key]

    T = len(times)
    for b in bones:
        q = clip.get(b, {}).get('rotation')
        if q is None:
            q = np.broadcast_to(rest_q[b], (T, 4))
        q = np.broadcast_to(q, (T, 4))
        q = quat_continuity(q / np.linalg.norm(q, axis=1, keepdims=True))
        keep = reduce_keys(times, q, 0.0015)
        qi = np.round(np.clip(q[keep], -1, 1) * 32767).astype(np.int16)
        samplers.append({'input': times_acc(times[keep]), 'output': g.add_accessor(qi, typ='VEC4', normalized=True),
                         'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers) - 1, 'target': {'node': b, 'path': 'rotation'}})
    tr = clip.get(hips, {}).get('translation')
    if tr is None:
        tr = np.broadcast_to(rest_t[hips], (T, 3))
    tr = np.broadcast_to(tr, (T, 3))
    keep = reduce_keys(times, tr, 0.02)
    samplers.append({'input': times_acc(times[keep]), 'output': g.add_accessor(tr[keep].astype(np.float32)),
                     'interpolation': 'LINEAR'})
    channels.append({'sampler': len(samplers) - 1, 'target': {'node': hips, 'path': 'translation'}})
    g.json.setdefault('animations', []).append({'name': name, 'channels': channels, 'samplers': samplers})


def make_loop(times, clip, blend: float = 0.25):
    """Cross-fade the end of a clip into its start so it loops without a pop."""
    T = len(times)
    n = max(2, int(blend * FPS))
    w = np.zeros(T)
    w[T - n:] = ease(np.linspace(0, 1, n))
    first = {i: {p: np.broadcast_to(v[:1], v.shape) for p, v in tr.items()} for i, tr in clip.items()}
    return blend_clips(clip, first, w)


# ------------------------------------------------------------------ the clip set
def build_clips(body: Glb, meshy_path: str, log):
    dst = Skeleton(body, 'mixamorig:')
    bones = list(dst.order)
    hips = dst.root_joint
    native = {a['name']: a for a in body.json.get('animations', [])}
    have = {}
    for nm in ('idle', 'walk', 'dance', 'sad', 'angry', 'backflip', 'CB_Idle_9'):
        if nm in native:
            have[nm] = read_clip(body, native[nm])
    meshy = Glb(meshy_path)
    src = Skeleton(meshy)
    for an in meshy.json.get('animations', []):
        if an['name'] in ('Running', 'Wave_for_Help_4', 'Happy_Sway_Standing', 'Joyful_Dance_with_Hand_Sway',
                          'Checkout_Gesture', 'Clapping_Run', 'Walking'):
            t, c = read_clip(meshy, an)
            have['meshy_' + an['name']] = (t, retarget(src, dst, t, c, log))
    log('source clips:', ', '.join(f'{k} {v[0][-1]:.1f}s' for k, v in have.items()))

    from authored import author_clips
    final = author_clips(dst, have, log)
    body.json['animations'] = []
    # Only the 41 body bones get tracks; the CB_* eye/lid/lash bones are driven by the runtime.
    bones = [b for b in bones if not body.json['nodes'][b].get('name', '').startswith('CB_')]
    # In place: drop horizontal root motion (the scene moves her), keep the vertical bounce.
    root_m = dst.ancestor_world(hips)[:3, :3]
    inv_root = np.linalg.inv(root_m)
    rest_w = root_m @ dst.rest_t[hips]
    for name, (t, c) in final.items():
        tr = c.get(hips, {}).get('translation')
        if tr is not None:
            w = (root_m @ np.broadcast_to(tr, (len(t), 3)).T).T
            w[:, 0] = rest_w[0]
            w[:, 2] = rest_w[2]
            c[hips]['translation'] = (inv_root @ w.T).T
        write_clip(body, name, t, c, bones, hips, dst.rest_q, dst.rest_t)
    log('clips:', ', '.join(f'{k} {v[0][-1]:.1f}s' for k, v in final.items()))
