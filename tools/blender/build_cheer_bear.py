#!/usr/bin/env python3
"""Build public/models/cheer-bear.glb: the one Cheer Bear used everywhere.

    python3 tools/blender/build_cheer_bear.py            # writes public/models/cheer-bear.glb
    python3 tools/blender/build_cheer_bear.py --report   # also prints the per-shape tear metrics

Inputs (read-only, override with env vars):
  CB_BODY  care-bear-animated.glb  low-poly rigged bear: mesh + 41-bone Mixamo skin + the body clips that are real
  CB_FACE  care-bear.glb           same mesh (identical vertex order, verified) + the 52 ARKit shapes baked by Faceit
  CB_MESHY Cheer-bear-animated.glb the heavy Meshy bear the AR scenes used: only its clips are taken (retargeted)

What it does (see docs/handoff/bear-lipsync.md for the why):
  1. Takes the body file as the base (clean 41-bone skin, no Faceit face bones).
  2. Drops the hand-made A/i/U/E/O shape keys (they are what tore: inverted triangles, edges stretched 6-10x at the
     mouth corners, and they never moved the tongue mesh).
  3. Copies the clean ARKit shapes from the face file by vertex index, keeping the ones we use.
  4. Bakes 14 `viseme_*` targets (lip shape only; the jaw is a separate channel) from viseme_recipes.json.
  5. Replaces the broken eyeBlink shapes (lid folds into a V, lashes crumple, 63 flipped triangles) with bones:
     eye bones (look-at), lid bones that rotate a fur shell over the eyeball, lash bones that carry the lashes down.
  6. Fixes materials: lashes use their alpha (they rendered as black blocks), no 2x specular.
  7. Body clips: keeps the real native clips, retargets the Meshy clips onto this skeleton, authors the missing ones
     (sleep, wakeUp, shiver, talkIdle) and names them by the app's BearClip names.
  8. Re-encodes textures (JPEG for opaque maps) and writes sparse morph targets + int16 rotation keys.
No Blender is required: the source of truth is the two GLBs exported from the Faceit scene (the .blend in the project
folder is the heavy Meshy bear, not this one). Needs only python3 + numpy + Pillow.
"""
from __future__ import annotations

import io
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from gltf_io import Glb, mat_to_trs, trs_to_mat, quat_axis_angle, quat_mul, quat_continuity  # noqa: E402
import clips as clipkit  # noqa: E402

REPO = HERE.parent.parent
SRC = Path('/mnt/user-data/uploads')
BODY = os.environ.get('CB_BODY', str(SRC / 'Personality-ARAI/public/models/care-bear-animated.glb'))
FACE = os.environ.get('CB_FACE', str(SRC / 'Personality-ARAI/public/models/care-bear.glb'))
MESHY = os.environ.get('CB_MESHY', str(SRC / 'CheerBearAR/3D/Cheer-bear-animated.glb'))
OUT = os.environ.get('CB_OUT', str(REPO / 'public/models/cheer-bear.glb'))
RECIPES = json.loads((HERE / 'viseme_recipes.json').read_text())

# ARKit shapes kept in the final model (expressions + what the viseme recipes and a future face-mirroring mode use).
KEEP_ARKIT = [
    'jawOpen', 'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthSmileLeft', 'mouthSmileRight',
    'mouthFrownLeft', 'mouthFrownRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthPressLeft', 'mouthPressRight',
    'mouthRollLower', 'mouthRollUpper', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthUpperUpLeft',
    'mouthUpperUpRight', 'mouthDimpleLeft', 'mouthDimpleRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
    'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'browDownLeft', 'browDownRight', 'browInnerUp',
    'browOuterUpLeft', 'browOuterUpRight', 'noseSneerLeft', 'noseSneerRight', 'tongueOut',
]
VISEMES = ['PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U']
TINY = 1e-5  # model units (the mesh is ~26 units tall); deltas below this are written as zero


def log(*a):
    print('[build]', *a, flush=True)


# ------------------------------------------------------------------ skeleton helpers
def node_parents(j):
    par = {}
    for i, n in enumerate(j['nodes']):
        for c in n.get('children', []):
            par[c] = i
    return par


def world_rest(j, par, i, cache=None):
    cache = {} if cache is None else cache
    if i in cache:
        return cache[i]
    n = j['nodes'][i]
    m = trs_to_mat(n.get('translation'), n.get('rotation'), n.get('scale'))
    if i in par:
        m = world_rest(j, par, par[i], cache) @ m
    cache[i] = m
    return m


def find_node(j, name):
    for i, n in enumerate(j['nodes']):
        if n.get('name') == name:
            return i
    raise KeyError(name)


# ------------------------------------------------------------------ morph targets
def expand_recipe(shapes: dict) -> dict:
    out = {}
    for k, w in shapes.items():
        if k.endswith('*'):
            out[k[:-1] + 'Left'] = w
            out[k[:-1] + 'Right'] = w
        else:
            out[k] = w
    return out


def face_targets(face: Glb, mesh_i: int, prim_i: int) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    m = face.json['meshes'][mesh_i]
    names = m['extras']['targetNames']
    p = m['primitives'][prim_i]
    return {names[k]: (face.get(t['POSITION']), face.get(t['NORMAL']) if 'NORMAL' in t else None)
            for k, t in enumerate(p.get('targets', []))}


def rebuild_targets(body: Glb, face: Glb):
    """Replace every mesh's targets: ARKit (kept subset) + baked lips-only visemes. Eyes get none (bones drive them)."""
    jb = body.json
    for mi, mesh in enumerate(jb['meshes']):
        fm = face.json['meshes'][mi]
        assert fm['name'] == mesh['name'], (fm['name'], mesh['name'])
        per_prim = []
        for pi, prim in enumerate(mesh['primitives']):
            pb = body.get(prim['attributes']['POSITION'])
            pf = face.get(fm['primitives'][pi]['attributes']['POSITION'])
            assert pb.shape == pf.shape and np.abs(pb - pf).max() < 1e-4, f'vertex order differs on {mesh["name"]}#{pi}'
            src = face_targets(face, mi, pi) if fm['primitives'][pi].get('targets') else {}
            nverts = pb.shape[0]
            zero = np.zeros((nverts, 3))
            tg: dict[str, tuple[np.ndarray, np.ndarray]] = {}
            for name in KEEP_ARKIT:
                if name in src:
                    tg[name] = (src[name][0], src[name][1] if src[name][1] is not None else zero)
            for v in VISEMES:
                rec = expand_recipe(RECIPES[v]['shapes'])
                dp = zero.copy()
                dn = zero.copy()
                for s, w in rec.items():
                    if s in src:
                        dp += w * src[s][0]
                        if src[s][1] is not None:
                            dn += w * src[s][1]
                tg['viseme_' + v] = (dp, dn)
            per_prim.append(tg)
        # Keep a target on this mesh only if it moves something on any primitive (eyes end up with none).
        names = [n for n in list(per_prim[0].keys())
                 if any(np.abs(tg[n][0]).max() > TINY for tg in per_prim)]
        if mesh['name'] in ('CheerBear.001', 'CheerBear.002'):
            names = []
        for pi, prim in enumerate(mesh['primitives']):
            targets = []
            for n in names:
                dp, dn = per_prim[pi][n]
                dp = np.where(np.abs(dp) < TINY, 0, dp).astype(np.float32)
                dn = np.where(np.abs(dn) < 1e-4, 0, dn).astype(np.float32)
                targets.append({'POSITION': body.add_accessor(dp, sparse=True),
                                'NORMAL': body.add_accessor(dn, sparse=True)})
            if targets:
                prim['targets'] = targets
            else:
                prim.pop('targets', None)
        if names:
            mesh['extras'] = {'targetNames': names}
            mesh['weights'] = [0.0] * len(names)
        else:
            mesh.pop('extras', None)
            mesh.pop('weights', None)
        log(f'{mesh["name"]}: {len(names)} targets')


# ------------------------------------------------------------------ eyes, lids, lashes
def ray_hits(tris: np.ndarray, o: np.ndarray, d: np.ndarray) -> np.ndarray:
    t0, t1, t2 = tris[:, 0], tris[:, 1], tris[:, 2]
    e1 = t1 - t0
    e2 = t2 - t0
    h = np.cross(d, e2)
    a = (e1 * h).sum(1)
    ok = np.abs(a) > 1e-12
    f = np.where(ok, 1 / np.where(ok, a, 1), 0)
    s = o - t0
    u = f * (s * h).sum(1)
    q = np.cross(s, e1)
    v = f * (q @ d)
    t = f * (e2 * q).sum(1)
    hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-6)
    return np.sort(t[hit])


def sph(el, az):
    el = np.radians(el)
    az = np.radians(az)
    return np.stack([np.sin(az) * np.cos(el), np.sin(el), np.cos(az) * np.cos(el)], -1)


def plain_fur_uv(body: Glb, HP, HUV, c, r):
    """UV of a head texel near the eye that is plain fur: close to the median fur colour, low local variance."""
    mat = body.json['materials'][body.json['meshes'][0]['primitives'][0]['material']]
    tex = body.json['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]
    img = np.asarray(Image.open(io.BytesIO(body.image_bytes[tex['source']])).convert('RGB')).astype(float)
    h, w = img.shape[:2]
    med = np.median(img.reshape(-1, 3), 0)
    near = np.nonzero((np.linalg.norm(HP - c, axis=1) < 2.6 * r) & (HP[:, 2] > c[2]))[0]
    best, best_uv = 1e9, HUV[near[0]]
    for v in near:
        u, vv = HUV[v] % 1.0
        x, y = int(u * (w - 1)), int(vv * (h - 1))
        patch = img[max(0, y - 6):y + 7, max(0, x - 6):x + 7].reshape(-1, 3)
        score = np.linalg.norm(patch.mean(0) - med) + patch.std(0).sum()
        if score < best:
            best, best_uv = score, HUV[v]
    return best_uv


def lid_material(body: Glb) -> int:
    """The head fur material, lifted a little: the lid sits recessed in the socket and otherwise reads darker."""
    import copy
    m = copy.deepcopy(body.json['materials'][body.json['meshes'][0]['primitives'][0]['material']])
    m['name'] = 'lid_fur'
    m['emissiveTexture'] = dict(m['pbrMetallicRoughness']['baseColorTexture'])
    m['emissiveFactor'] = [0.3, 0.3, 0.3]
    body.json['materials'].append(m)
    return len(body.json['materials']) - 1


def build_eye_rig(body: Glb):
    """Adds eye/lid/lash bones under the Head, a fur lid shell per eye, and re-skins eyes and lashes."""
    j = body.json
    par = node_parents(j)
    cache: dict = {}
    skin = j['skins'][0]
    ibm = body.get(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)  # column-major -> row-major
    head_n = find_node(j, 'mixamorig:Head')
    head_j = skin['joints'].index(head_n)
    B = world_rest(j, par, head_n, cache) @ ibm[head_j]  # mesh space -> world at bind
    hips_n = find_node(j, 'mixamorig:Hips')
    B2 = world_rest(j, par, hips_n, cache) @ ibm[skin['joints'].index(hips_n)]
    assert np.abs(B - B2).max() < 1e-3, 'rest pose is not the bind pose'

    head_mesh = j['meshes'][0]['primitives'][0]
    HP = body.get(head_mesh['attributes']['POSITION'])
    HUV = body.get(head_mesh['attributes']['TEXCOORD_0'])
    HI = body.get(head_mesh['indices'], as_float=False).reshape(-1, 3).astype(np.int64)
    tris = HP[HI]

    mesh_by_node = {n.get('name'): n['mesh'] for n in j['nodes'] if 'mesh' in n}
    lash_mesh = j['meshes'][mesh_by_node['Eyelash_L']]['primitives'][0]
    LP = body.get(lash_mesh['attributes']['POSITION'])

    new_joint_ids = {}
    lid_geo = []
    rig = {}
    for side, eye_node_name, sign in (('L', 'Eye_L', 1), ('R', 'Eye_R', -1)):
        eprim = j['meshes'][mesh_by_node[eye_node_name]]['primitives'][0]
        EP = body.get(eprim['attributes']['POSITION'])
        EUV = body.get(eprim['attributes']['TEXCOORD_0'])
        c = (EP.min(0) + EP.max(0)) / 2
        r = float(np.linalg.norm(EP - c, axis=1).mean())
        k = int(np.argmin(np.linalg.norm(EUV - 0.5, axis=1)))  # iris centre
        g = EP[k] - c
        yaw = float(np.arctan2(g[0], g[2]))
        Rf = np.eye(4)
        Rf[:3, :3] = np.array([[np.cos(yaw), 0, np.sin(yaw)], [0, 1, 0], [-np.sin(yaw), 0, np.cos(yaw)]])
        frame = trs_to_mat(c) @ Rf  # mesh space: origin at eye centre, +z = gaze, +y = up, +x = gaze-right axis

        # Visible part of the eyeball, in frame angles: a sphere point is visible when an odd number of head-surface
        # crossings lie between the centre and the point.
        vis = []
        for el in range(-80, 81, 4):
            for az in range(-90, 91, 4):
                d = (Rf[:3, :3] @ sph(el, az))
                hits = ray_hits(tris, c, d)
                if (hits < r).sum() % 2 == 1:
                    vis.append((el, az))
        vis = np.array(vis)
        el_min, el_max = vis[:, 0].min(), vis[:, 0].max()
        az_min, az_max = vis[:, 1].min(), vis[:, 1].max()
        log(f'eye {side}: r={r:.3f} yaw={np.degrees(yaw):.1f} visible el {el_min}..{el_max} az {az_min}..{az_max}')

        # Lid shell (closed pose), then rotated up into the head for the open (rest) pose.
        R = r * 1.045
        e0, e1 = el_min - 10, el_max + 12
        a0, a1 = az_min - 12, az_max + 12
        theta = np.radians(el_max - el_min + 20)  # rest rotation (open) relative to closed
        ne, na = 12, 16
        els = np.linspace(e0, e1, ne)
        azs = np.linspace(a0, a1, na)
        EL, AZ = np.meshgrid(els, azs, indexing='ij')
        dirs = sph(EL, AZ).reshape(-1, 3)
        ca, sa = np.cos(-theta), np.sin(-theta)
        Rx_open = np.array([[1, 0, 0], [0, ca, -sa], [0, sa, ca]])
        local = (dirs * R) @ Rx_open.T
        # Normals lean towards the gaze so the lid catches the same light as the fur around it (pure radial normals
        # read as a dark hollow).
        nrm_local = (dirs + np.array([0, 0.35, 0.9])) @ Rx_open.T
        pos = (frame[:3, :3] @ local.T).T + c
        nrm = (frame[:3, :3] @ nrm_local.T).T
        # Check: no shell vertex sits on the visible eye in the open pose.
        opened = np.degrees(np.arctan2(local[:, 1], np.hypot(local[:, 0], local[:, 2])))
        opened_az = np.degrees(np.arctan2(local[:, 0], local[:, 2]))
        exposed = ((opened > el_min) & (opened < el_max) & (opened_az > az_min) & (opened_az < az_max)
                   & (local[:, 2] > 0))
        log(f'  lid shell: {len(pos)} verts, open-pose verts over the eye: {int(exposed.sum())}, theta {np.degrees(theta):.0f} deg')
        # Fur UV: the head texel just above the eye.
        uv0 = plain_fur_uv(body, HP, HUV, c, r)
        uv = np.stack([uv0[0] + (AZ.ravel() - AZ.mean()) / 2400.0, uv0[1] + (EL.ravel() - EL.mean()) / 2400.0], -1)
        idx = []
        for ie in range(ne - 1):
            for ia in range(na - 1):
                a = ie * na + ia
                b = a + 1
                cc = a + na
                d = cc + 1
                idx += [a, cc, b, b, cc, d]
        lid_geo.append((side, pos, nrm, uv, np.array(idx)))

        # Lashes: which lash verts belong to this eye, and how far they swing to sit on the closed lid.
        lash_sel = (LP[:, 0] > 0) if sign > 0 else (LP[:, 0] <= 0)
        rig[side] = dict(c=c, r=r, frame=frame, theta=float(theta), lash_sel=lash_sel,
                         lash_theta=float(np.radians((el_max - el_min) * 0.45)))

    # --- create bones (children of Head). Bone frame = eye frame mapped to world by B.
    head_world = world_rest(j, par, head_n, cache)
    for side in ('L', 'R'):
        for kind in ('Eye', 'Lid', 'Lash'):
            W = B @ rig[side]['frame']
            local = np.linalg.inv(head_world) @ W
            t, q, s = mat_to_trs(local)
            node = {'name': f'CB_{kind}_{side}', 'translation': t.tolist(), 'rotation': q.tolist(), 'scale': s.tolist()}
            j['nodes'].append(node)
            ni = len(j['nodes']) - 1
            j['nodes'][head_n].setdefault('children', []).append(ni)
            skin['joints'].append(ni)
            new_joint_ids[(kind, side)] = len(skin['joints']) - 1
            ibm = np.concatenate([ibm, np.linalg.inv(rig[side]['frame'])[None]], 0)
    skin['inverseBindMatrices'] = body.add_accessor(
        ibm.transpose(0, 2, 1).reshape(-1, 16).astype(np.float32), typ='MAT4')

    def reskin(prim, joint_for_vertex: np.ndarray):
        J = body.get(prim['attributes']['JOINTS_0'], as_float=False).copy()
        jt = J.dtype
        J[:] = 0
        J[:, 0] = joint_for_vertex
        Wt = np.zeros((J.shape[0], 4), np.float32)
        Wt[:, 0] = 1
        prim['attributes']['JOINTS_0'] = body.add_accessor(J.astype(jt))
        prim['attributes']['WEIGHTS_0'] = body.add_accessor(Wt)

    for side, eye_node_name in (('L', 'Eye_L'), ('R', 'Eye_R')):
        eprim = j['meshes'][mesh_by_node[eye_node_name]]['primitives'][0]
        n = body.arrays[eprim['attributes']['POSITION']].shape[0]
        reskin(eprim, np.full(n, new_joint_ids[('Eye', side)]))
    lash_j = np.where(rig['L']['lash_sel'], new_joint_ids[('Lash', 'L')], new_joint_ids[('Lash', 'R')])
    reskin(lash_mesh, lash_j)

    # --- lid shell mesh (one primitive for both eyes, head material)
    P = np.concatenate([g[1] for g in lid_geo]).astype(np.float32)
    N = np.concatenate([g[2] for g in lid_geo])
    N = (N / np.linalg.norm(N, axis=1, keepdims=True)).astype(np.float32)
    UV = np.concatenate([g[3] for g in lid_geo]).astype(np.float32)
    off = 0
    I = []
    Jv = []
    for side, pos, _n, _uv, idx in lid_geo:
        I.append(idx + off)
        Jv.append(np.full(len(pos), new_joint_ids[('Lid', side)]))
        off += len(pos)
    I = np.concatenate(I).astype(np.uint16)
    Jm = np.zeros((len(P), 4), body.arrays[lash_mesh['attributes']['JOINTS_0']].dtype)
    Jm[:, 0] = np.concatenate(Jv)
    Wm = np.zeros((len(P), 4), np.float32)
    Wm[:, 0] = 1
    prim = {'attributes': {'POSITION': body.add_accessor(P), 'NORMAL': body.add_accessor(N),
                           'TEXCOORD_0': body.add_accessor(UV), 'JOINTS_0': body.add_accessor(Jm),
                           'WEIGHTS_0': body.add_accessor(Wm)},
            'indices': body.add_accessor(I.reshape(-1, 1)), 'material': lid_material(body), 'mode': 4}
    j['meshes'].append({'name': 'CB_Lids', 'primitives': [prim]})
    j['nodes'].append({'name': 'Lids', 'mesh': len(j['meshes']) - 1, 'skin': 0})
    root = j['scenes'][0]['nodes'][0]
    j['nodes'][root]['children'].append(len(j['nodes']) - 1)

    # Rig parameters for the runtime (radians). Stored on the scene so the Bear reads them instead of guessing.
    j['scenes'][0].setdefault('extras', {})['cheerBearRig'] = {
        'lidClose': {s: rig[s]['theta'] for s in ('L', 'R')},
        'lashClose': {s: rig[s]['lash_theta'] for s in ('L', 'R')},
        'lashPush': 0.12,
        'visemeJaw': {v: RECIPES[v]['jaw'] for v in VISEMES},
        'eyeLimits': {'yaw': 0.45, 'pitch': 0.3},
        'axes': 'bone local: +x = lid/eye pitch axis (positive closes / looks down), +y = yaw, +z = gaze. Lash bones also scale by 1 + lashPush * blink so the lashes stay on top of the closed lid.',
    }


# ------------------------------------------------------------------ materials and textures
def fix_materials(body: Glb):
    j = body.json
    for m in j['materials']:
        m.get('extensions', {}).pop('KHR_materials_specular', None)
        if not m.get('extensions'):
            m.pop('extensions', None)
        m['pbrMetallicRoughness']['roughnessFactor'] = 0.82
    lash_mat = j['meshes'][[n['mesh'] for n in j['nodes'] if n.get('name') == 'Eyelash_L'][0]]['primitives'][0]['material']
    j['materials'][lash_mat]['alphaMode'] = 'MASK'
    j['materials'][lash_mat]['alphaCutoff'] = 0.5
    used = set(j.get('extensionsUsed', [])) - {'KHR_materials_specular'}
    if used:
        j['extensionsUsed'] = sorted(used)
    else:
        j.pop('extensionsUsed', None)

    # Re-encode: opaque maps as JPEG, the lash keeps PNG alpha.
    for i, im in enumerate(j['images']):
        img = Image.open(io.BytesIO(body.image_bytes[i]))
        has_alpha = img.mode in ('RGBA', 'LA') and np.asarray(img)[..., -1].min() < 250
        bio = io.BytesIO()
        if has_alpha:
            img.save(bio, 'PNG', optimize=True)
            im['mimeType'] = 'image/png'
        else:
            img.convert('RGB').save(bio, 'JPEG', quality=88, optimize=True, progressive=False)
            im['mimeType'] = 'image/jpeg'
        log(f'image {im.get("name")}: {len(body.image_bytes[i]) // 1024} KB -> {len(bio.getvalue()) // 1024} KB')
        body.image_bytes[i] = bio.getvalue()


# ------------------------------------------------------------------ main
def tear_report(path: str, title: str) -> None:
    """Per morph target at weight 1.0: flipped triangles and worst edge stretch (moved triangles only)."""
    g = Glb(path)
    j = g.json
    print(f'\n{title}: {path}')
    print(f'  {"shape":24s} {"flipped":>7s} {"max stretch":>11s}')
    for mesh in j['meshes']:
        names = mesh.get('extras', {}).get('targetNames', [])
        for prim in mesh['primitives']:
            if not prim.get('targets') or 'indices' not in prim:
                continue
            P = g.get(prim['attributes']['POSITION']).astype(np.float64)
            tri = g.get(prim['indices'], as_float=False).astype(np.int64).reshape(-1, 3)
            a, b, c = P[tri[:, 0]], P[tri[:, 1]], P[tri[:, 2]]
            n0 = np.cross(b - a, c - a)
            e0 = np.stack([np.linalg.norm(b - a, axis=1), np.linalg.norm(c - b, axis=1), np.linalg.norm(a - c, axis=1)], 1)
            ok = (np.linalg.norm(n0, axis=1) > 1e-12) & (e0.min(1) > 1e-9)
            print(f'  [{mesh.get("name", "?")}]')
            for ti, t in enumerate(prim['targets']):
                if 'POSITION' not in t:
                    continue
                Q = P + g.get(t['POSITION']).astype(np.float64)
                A, B, C = Q[tri[:, 0]], Q[tri[:, 1]], Q[tri[:, 2]]
                moved = ok & ((np.abs(Q - P).max(1)[tri] > 1e-6).any(1))
                if not moved.any() or (np.abs(Q - P).max() < 1e-5):
                    continue
                n1 = np.cross(B - A, C - A)
                flips = int(((n0 * n1).sum(1)[moved] < 0).sum())
                e1 = np.stack([np.linalg.norm(B - A, axis=1), np.linalg.norm(C - B, axis=1), np.linalg.norm(A - C, axis=1)], 1)
                stretch = float((e1[moved] / e0[moved]).max())
                name = names[ti] if ti < len(names) else f'#{ti}'
                print(f'  {name:24s} {flips:7d} {stretch:10.1f}x')


def main():
    log('body', BODY)
    body = Glb(BODY)
    face = Glb(FACE)
    rebuild_targets(body, face)
    build_eye_rig(body)
    fix_materials(body)
    clipkit.build_clips(body, MESHY, log)
    body.json['asset'] = {'version': '2.0', 'generator': 'cheerbearar tools/blender/build_cheer_bear.py'}
    size = body.save(OUT)
    log(f'wrote {OUT} ({size / 1024 / 1024:.2f} MB)')
    if '--report' in sys.argv:
        tear_report(FACE, 'BEFORE (old face file, the shapes the old app drove)')
        tear_report(OUT, 'AFTER (shipped model)')


if __name__ == '__main__':
    main()
