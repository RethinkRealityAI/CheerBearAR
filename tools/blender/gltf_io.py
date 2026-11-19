"""Minimal GLB reader/writer used by the Cheer Bear build (numpy only, no Blender needed).

Reads every accessor into numpy (dense or sparse), lets the build script edit the JSON and arrays, then writes a fresh
GLB: one buffer, one bufferView per accessor/image, unused accessors dropped, morph targets written as sparse
accessors when that is smaller.
"""
from __future__ import annotations

import json
import struct
from typing import Any

import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
CT_INV = {np.dtype(v): k for k, v in CT.items()}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
NC_INV = {v: k for k, v in NC.items()}


class Glb:
    def __init__(self, path: str):
        data = open(path, 'rb').read()
        magic, _ver, _len = struct.unpack('<III', data[:12])
        assert magic == 0x46546C67, 'not a GLB'
        n = struct.unpack('<I', data[12:16])[0]
        self.json: dict[str, Any] = json.loads(data[20:20 + n])
        off = 20 + n
        bl = struct.unpack('<I', data[off:off + 4])[0]
        self._bin = data[off + 8:off + 8 + bl]
        # Decoded accessors (index -> array). Arrays keep their stored dtype; `normalized` is kept in the JSON.
        self.arrays: dict[int, np.ndarray] = {}
        for i in range(len(self.json.get('accessors', []))):
            self.arrays[i] = self._decode(i)
        self.image_bytes: list[bytes] = []
        for im in self.json.get('images', []):
            bv = self.json['bufferViews'][im['bufferView']]
            o = bv.get('byteOffset', 0)
            self.image_bytes.append(self._bin[o:o + bv['byteLength']])

    # ---------------------------------------------------------------- read
    def _decode(self, i: int) -> np.ndarray:
        a = self.json['accessors'][i]
        dt = CT[a['componentType']]
        nc = NC[a['type']]
        if 'bufferView' in a:
            bv = self.json['bufferViews'][a['bufferView']]
            start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
            isz = np.dtype(dt).itemsize * nc
            stride = bv.get('byteStride', 0)
            if stride and stride != isz:
                raw = np.frombuffer(self._bin, np.uint8, count=stride * a['count'], offset=start)
                arr = raw.reshape(a['count'], stride)[:, :isz].copy().view(dt).reshape(a['count'], nc)
            else:
                arr = np.frombuffer(self._bin, dt, count=a['count'] * nc, offset=start).reshape(a['count'], nc).copy()
        else:
            arr = np.zeros((a['count'], nc), dt)
        sp = a.get('sparse')
        if sp:
            ib = self.json['bufferViews'][sp['indices']['bufferView']]
            vb = self.json['bufferViews'][sp['values']['bufferView']]
            idx = np.frombuffer(self._bin, CT[sp['indices']['componentType']], count=sp['count'],
                                offset=ib.get('byteOffset', 0) + sp['indices'].get('byteOffset', 0))
            vals = np.frombuffer(self._bin, dt, count=sp['count'] * nc,
                                 offset=vb.get('byteOffset', 0) + sp['values'].get('byteOffset', 0)).reshape(-1, nc)
            arr[idx.astype(np.int64)] = vals
        return arr

    def get(self, i: int, as_float: bool = True) -> np.ndarray:
        """Accessor as float64 (normalized ints are scaled to -1..1 / 0..1)."""
        arr = self.arrays[i]
        if not as_float:
            return arr
        a = self.json['accessors'][i]
        if a.get('normalized'):
            info = np.iinfo(arr.dtype)
            return np.maximum(arr.astype(np.float64) / info.max, -1.0)
        return arr.astype(np.float64)

    # ---------------------------------------------------------------- edit
    def add_accessor(self, arr: np.ndarray, typ: str | None = None, normalized: bool = False,
                     sparse: bool = False, minmax: bool = False) -> int:
        arr = np.ascontiguousarray(arr)
        if arr.ndim == 1:
            arr = arr.reshape(-1, 1)
        typ = typ or NC_INV[arr.shape[1]]
        acc: dict[str, Any] = {'componentType': CT_INV[arr.dtype], 'count': int(arr.shape[0]), 'type': typ}
        if normalized:
            acc['normalized'] = True
        if sparse:
            acc['_sparse'] = True
        if minmax:
            acc['_minmax'] = True
        self.json.setdefault('accessors', []).append(acc)
        i = len(self.json['accessors']) - 1
        self.arrays[i] = arr
        return i

    # ---------------------------------------------------------------- write
    def _referenced_accessors(self) -> list[int]:
        j = self.json
        refs: set[int] = set()
        for m in j.get('meshes', []):
            for p in m['primitives']:
                refs.update(p['attributes'].values())
                if 'indices' in p:
                    refs.add(p['indices'])
                for t in p.get('targets', []):
                    refs.update(t.values())
        for s in j.get('skins', []):
            if 'inverseBindMatrices' in s:
                refs.add(s['inverseBindMatrices'])
        for an in j.get('animations', []):
            for smp in an['samplers']:
                refs.add(smp['input'])
                refs.add(smp['output'])
        return sorted(refs)

    def save(self, path: str) -> int:
        j = self.json
        old = j.get('accessors', [])
        keep = self._referenced_accessors()
        remap = {o: n for n, o in enumerate(keep)}
        buf = bytearray()
        views: list[dict[str, Any]] = []

        def push(data: bytes, target: int | None = None) -> int:
            while len(buf) % 4:
                buf.append(0)
            v: dict[str, Any] = {'buffer': 0, 'byteOffset': len(buf), 'byteLength': len(data)}
            if target:
                v['target'] = target
            buf.extend(data)
            views.append(v)
            return len(views) - 1

        # Which accessors are vertex attributes / indices (for bufferView targets) and which are POSITION (min/max).
        attr_ids: set[int] = set()
        idx_ids: set[int] = set()
        pos_ids: set[int] = set()
        target_ids: set[int] = set()
        for m in j.get('meshes', []):
            for p in m['primitives']:
                attr_ids.update(p['attributes'].values())
                pos_ids.add(p['attributes']['POSITION'])
                if 'indices' in p:
                    idx_ids.add(p['indices'])
                for t in p.get('targets', []):
                    target_ids.update(t.values())
                    if 'POSITION' in t:
                        pos_ids.add(t['POSITION'])
        anim_in: set[int] = set()
        for an in j.get('animations', []):
            for smp in an['samplers']:
                anim_in.add(smp['input'])

        new_acc = []
        for o in keep:
            a = dict(old[o])
            arr = self.arrays[o]
            want_sparse = a.pop('_sparse', False) or (o in target_ids)
            a.pop('_minmax', None)
            for k in ('bufferView', 'byteOffset', 'sparse', 'min', 'max'):
                a.pop(k, None)
            a['componentType'] = CT_INV[arr.dtype]
            a['count'] = int(arr.shape[0])
            a['type'] = NC_INV[arr.shape[1]] if a.get('type') != 'MAT4' else 'MAT4'
            nz = np.nonzero(np.any(arr != 0, axis=1))[0]
            if want_sparse and len(nz) * (arr.itemsize * arr.shape[1] + 4) < arr.nbytes * 0.8:
                if len(nz) == 0:
                    nz = np.array([0])
                ict = np.uint16 if arr.shape[0] < 65536 else np.uint32
                a['sparse'] = {
                    'count': int(len(nz)),
                    'indices': {'bufferView': push(nz.astype(ict).tobytes()), 'componentType': CT_INV[np.dtype(ict)]},
                    'values': {'bufferView': push(np.ascontiguousarray(arr[nz]).tobytes())},
                }
            else:
                tgt = 34963 if o in idx_ids else (34962 if (o in attr_ids or o in target_ids) else None)
                a['bufferView'] = push(np.ascontiguousarray(arr).tobytes(), tgt)
            if o in pos_ids or o in anim_in:
                a['min'] = [float(x) for x in arr.min(0)]
                a['max'] = [float(x) for x in arr.max(0)]
            new_acc.append(a)

        # images
        for i, im in enumerate(j.get('images', [])):
            im['bufferView'] = push(self.image_bytes[i])

        # remap references
        for m in j.get('meshes', []):
            for p in m['primitives']:
                p['attributes'] = {k: remap[v] for k, v in p['attributes'].items()}
                if 'indices' in p:
                    p['indices'] = remap[p['indices']]
                if 'targets' in p:
                    p['targets'] = [{k: remap[v] for k, v in t.items()} for t in p['targets']]
        for s in j.get('skins', []):
            if 'inverseBindMatrices' in s:
                s['inverseBindMatrices'] = remap[s['inverseBindMatrices']]
        for an in j.get('animations', []):
            for smp in an['samplers']:
                smp['input'] = remap[smp['input']]
                smp['output'] = remap[smp['output']]
        j['accessors'] = new_acc
        j['bufferViews'] = views
        while len(buf) % 4:
            buf.append(0)
        j['buffers'] = [{'byteLength': len(buf)}]
        self.arrays = {remap[o]: self.arrays[o] for o in keep}

        js = json.dumps(j, separators=(',', ':')).encode()
        while len(js) % 4:
            js += b' '
        total = 12 + 8 + len(js) + 8 + len(buf)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, total))
            f.write(struct.pack('<II', len(js), 0x4E4F534A))
            f.write(js)
            f.write(struct.pack('<II', len(buf), 0x004E4942))
            f.write(bytes(buf))
        return total


# ------------------------------------------------------------------ math helpers (glTF conventions: quat = x,y,z,w)
def quat_to_mat(q: np.ndarray) -> np.ndarray:
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def mat_to_quat(m: np.ndarray) -> np.ndarray:
    t = np.trace(m)
    if t > 0:
        s = np.sqrt(t + 1.0) * 2
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]
    q = np.array(q)
    return q / np.linalg.norm(q)


def trs_to_mat(t=None, r=None, s=None) -> np.ndarray:
    m = np.eye(4)
    rs = quat_to_mat(np.array(r if r is not None else [0, 0, 0, 1], float))
    sc = np.array(s if s is not None else [1, 1, 1], float)
    m[:3, :3] = rs * sc
    m[:3, 3] = t if t is not None else [0, 0, 0]
    return m


def mat_to_trs(m: np.ndarray):
    t = m[:3, 3].copy()
    sx, sy, sz = (np.linalg.norm(m[:3, i]) for i in range(3))
    r = m[:3, :3] / np.array([sx, sy, sz])
    if np.linalg.det(r) < 0:
        sx = -sx
        r[:, 0] = -r[:, 0]
    return t, mat_to_quat(r), np.array([sx, sy, sz])


def quat_mul(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Hamilton product for arrays of quats (..., 4) in x,y,z,w order."""
    ax, ay, az, aw = np.moveaxis(a, -1, 0)
    bx, by, bz, bw = np.moveaxis(b, -1, 0)
    return np.stack([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ], -1)


def quat_inv(q: np.ndarray) -> np.ndarray:
    return q * np.array([-1, -1, -1, 1])


def quat_axis_angle(axis, angle) -> np.ndarray:
    axis = np.asarray(axis, float)
    axis = axis / np.linalg.norm(axis)
    angle = np.asarray(angle, float)
    s = np.sin(angle / 2)[..., None]
    return np.concatenate([axis * s, np.cos(angle / 2)[..., None]], -1)


def quat_rotate(q: np.ndarray, v: np.ndarray) -> np.ndarray:
    qv = np.concatenate([v, np.zeros(v.shape[:-1] + (1,))], -1)
    return quat_mul(quat_mul(q, qv), quat_inv(q))[..., :3]


def quat_continuity(q: np.ndarray) -> np.ndarray:
    """Flip signs so consecutive keys take the short path."""
    q = q.copy()
    for i in range(1, len(q)):
        if np.dot(q[i], q[i - 1]) < 0:
            q[i] = -q[i]
    return q
