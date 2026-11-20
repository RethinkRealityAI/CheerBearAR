# Happi round 6 (Dapo 2026-11-20): keep the Meshy head (the part that looks good) and rebuild everything below it
# as clean, separate, closed parts with crisp flat textures, weighted by hand so nothing tears:
#   coat (open front, orange bands, closed navy back, crests, hem checker), sleeves (diamond cuffs), shirt (NYC apple),
#   pants, white mitten hands, sneakers (white sole, navy laces).
# The rig: arms 1.4x longer and shoulders a little wider (hands can clear the big head), legs a little apart (no shoe
# clipping). Every clip is re-baked so raised arms swing OUT to the side instead of up into the head, and the clips'
# forward hunch is taken out of the spine (stands straight).
# usage: python build_body.py -- in.blend out.glb [texdir]
import bpy, bmesh, math, sys, os
import numpy as np
from mathutils import Vector, Matrix, Quaternion
argv = sys.argv[sys.argv.index('--') + 1:]
BLEND, OUT = argv[0], argv[1]
TEX = argv[2] if len(argv) > 2 else '/home/user/happi-work/tex6'
bpy.ops.wm.open_mainfile(filepath=BLEND)
sc = bpy.context.scene
arm = bpy.data.objects['Happi']; body = bpy.data.objects['HappiBody']
face = bpy.data.objects['HappiFace']; tail = bpy.data.objects['HappiTail']
ad = arm.animation_data
for t in ad.nla_tracks: t.mute = True
ad.action = None
arm.data.pose_position = 'REST'
sc.frame_set(0)
bpy.context.view_layer.update()

# ------------------------------------------------------------------ materials
def srgb(c): return tuple(((x / 255 + 0.055) / 1.055) ** 2.4 if x / 255 > 0.04045 else x / 255 / 12.92 for x in c)
def mat(name, rgb=None, img=None, rough=0.55):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    if 'Specular IOR Level' in b.inputs: b.inputs['Specular IOR Level'].default_value = 0.35
    if img:
        im = bpy.data.images.load(f'{TEX}/{img}.png'); im.pack()
        tn = m.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = im
        m.node_tree.links.new(tn.outputs['Color'], b.inputs['Base Color'])
    else:
        b.inputs['Base Color'].default_value = (*srgb(rgb), 1)
    return m
NAVY, ORANGE, WHITE = (40, 58, 143), (243, 115, 33), (246, 246, 243)
M = {
    'coat': mat('Coat', img='coat'), 'sleeve': mat('Sleeve', img='sleeve'), 'shirt': mat('Shirt', img='shirt'),
    'navy': mat('Navy', NAVY, rough=0.6), 'white': mat('White', WHITE, rough=0.45), 'orange': mat('Orange', ORANGE, rough=0.5),
    'lining': mat('Lining', (30, 42, 108), rough=0.8),
}

# ------------------------------------------------------------------ rig: longer arms, wider shoulders, feet apart
def wpos(n): return arm.matrix_world @ arm.data.bones[n].head_local
bpy.context.view_layer.objects.active = arm; arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
def move_bone(n, new_head):
    b = eb[n]; d = b.tail - b.head; b.head = new_head; b.tail = new_head + d   # same direction + roll: clips keep working
ARM_K, SHOULDER_X = 1.4, 0.165
MW = arm.matrix_world.copy(); MWi = MW.inverted()       # edit bones live in armature space; plan in world metres
for s, L in ((1, 'Left'), (-1, 'Right')):
    a0, f0, h0 = (MW @ eb[L + n].head for n in ('Arm', 'ForeArm', 'Hand'))
    na = Vector((s * SHOULDER_X, a0.y, a0.z))
    nf = na + (f0 - a0) * ARM_K
    nh = nf + (h0 - f0) * ARM_K
    move_bone(L + 'Arm', MWi @ na); move_bone(L + 'ForeArm', MWi @ nf); move_bone(L + 'Hand', MWi @ nh)
    for n in (L + 'UpLeg', L + 'Leg', L + 'Foot', L + 'ToeBase'):
        h = MW @ eb[n].head; move_bone(n, MWi @ Vector((h.x + s * 0.014, h.y, h.z)))
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.update()
B = {b.name: wpos(b.name) for b in arm.data.bones}
for n in ('LeftArm', 'LeftForeArm', 'LeftHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase'): print('BONE', n, tuple(round(x, 3) for x in B[n]))

# ------------------------------------------------------------------ geometry helpers
def ring_pts(c, X, Y, rx, ry, n, p=2.0, th0=0.0, th1=2 * math.pi, closed=True):
    out = []
    cnt = n if closed else n + 1
    for i in range(cnt):
        th = th0 + (th1 - th0) * i / n
        cs, sn = math.cos(th), math.sin(th)
        x = math.copysign(abs(sn) ** (2 / p), sn) * rx; y = math.copysign(abs(cs) ** (2 / p), cs) * ry
        out.append(c + X * x + Y * y)
    return out

def loft(name, rings, n, closed=True, cap0=False, cap1=False, uv=None, solid=0.0, matl=None):
    """rings: list of point lists (same count). uv(i, j) -> (u, v) for ring j, point i."""
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    cnt = len(rings[0]); seg = cnt if closed else cnt - 1
    for j in range(len(rings) - 1):
        for i in range(seg):
            i2 = (i + 1) % cnt
            f = bm.faces.new((vs[j][i], vs[j][i2], vs[j + 1][i2], vs[j + 1][i]))
            if uv:
                for lp, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                    lp[uvl].uv = uv(ii, jj)
    for which, do in ((0, cap0), (len(rings) - 1, cap1)):
        if do:
            c = bm.verts.new(sum((v.co for v in vs[which]), Vector()) / cnt)
            for i in range(seg):
                tri = (vs[which][i], vs[which][(i + 1) % cnt], c)
                f = bm.faces.new(tri if which else tri[::-1])
                for lp in f.loops: lp[uvl].uv = (0.5, 0.02 if which == 0 else 0.98)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob)
    if matl: me.materials.append(matl)
    # outward normals
    me.update()
    ctr = sum((v.co for v in me.vertices), Vector()) / len(me.vertices)
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    if solid:
        sm = ob.modifiers.new('s', 'SOLIDIFY'); sm.thickness = solid; sm.offset = -1; sm.use_rim = True
        bpy.context.view_layer.objects.active = ob; bpy.ops.object.modifier_apply(modifier='s')
    for pl in me.polygons: pl.use_smooth = True
    return ob

def ellipsoid(name, c, r, matl, nu=40, nv=24):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=nu, v_segments=nv, radius=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * r[0], v.co.y * r[1], v.co.z * r[2])) + c
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for pl in me.polygons: pl.use_smooth = True
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob); me.materials.append(matl)
    return ob

def smooth(ob, lv=1):
    m = ob.modifiers.new('sub', 'SUBSURF'); m.levels = lv; m.render_levels = lv
    bpy.context.view_layer.objects.active = ob; bpy.ops.object.modifier_apply(modifier='sub')

# ------------------------------------------------------------------ weights
def weigh(ob, f):
    """f(world_pos) -> {bone: w}"""
    groups = {}
    for v in ob.data.vertices:
        ws = f(ob.matrix_world @ v.co)
        tot = sum(ws.values()) or 1
        for bn, w in ws.items():
            if w / tot < 0.01: continue
            g = groups.get(bn) or ob.vertex_groups.new(name=bn); groups[bn] = g
            g.add([v.index], w / tot, 'REPLACE')
    ob.parent = arm; ob.matrix_parent_inverse = arm.matrix_world.inverted()
    md = ob.modifiers.new('Armature', 'ARMATURE'); md.object = arm

def ss(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t)

SPINE = [('Hips', B['Hips'].z), ('Spine02', B['Spine02'].z), ('Spine01', B['Spine01'].z), ('Spine', B['Spine'].z)]
def torso_w(p):
    z = p.z
    if z <= SPINE[0][1]: return {'Hips': 1}
    if z >= SPINE[-1][1]: return {'Spine': 1}
    for (a, za), (b, zb) in zip(SPINE, SPINE[1:]):
        if za <= z <= zb:
            t = ss(0, 1, (z - za) / (zb - za)); return {a: 1 - t, b: t}

def chain_w(bones):
    """weights along a bone chain [(name, head, tail)]: by the closest segment, blended near the joints"""
    def f(p):
        best = []
        for n, a, b in bones:
            ab = b - a; t = max(0, min(1, (p - a).dot(ab) / ab.length_squared)); d = (p - (a + ab * t)).length
            best.append((d, n, t))
        ws = {}
        for d, n, t in best: ws[n] = ws.get(n, 0) + 1 / (d + 0.03) ** 6
        return ws
    return f

# ------------------------------------------------------------------ head: the Meshy head above the neck, rigid on Head
bm = bmesh.new(); bm.from_mesh(body.data)
bm.transform(body.matrix_world)
bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=2e-5)   # weld UV-seam splits (loop UVs survive)
ZCUT = 0.512
# a clean cut (bisect), not a ragged one along face centres, then a filled cap so the underside is closed
capl = bm.faces.layers.int.new('neck_cap')   # before any face refs: a new layer invalidates them
geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, ZCUT), plane_no=(0, 0, 1), clear_inner=True)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bnd = [e for e in bm.edges if e.is_boundary and all(abs(v.co.z - ZCUT) < 1e-4 for v in e.verts)]
print('NECK boundary edges', len(bnd))
res = bmesh.ops.holes_fill(bm, edges=bnd, sides=0)
cap = res['faces']
if cap:
    tri = bmesh.ops.triangulate(bm, faces=cap)
    capf = tri['faces']
    # dome the cap upward a little so it reads as a soft underside, not a flat plate
    cv = {v for f in capf for v in f.verts}
    ctr = sum((v.co for v in cv), Vector()) / len(cv)
    rmax = max((Vector((v.co.x - ctr.x, v.co.y - ctr.y)).length for v in cv)) or 1
    for v in cv:
        r = Vector((v.co.x - ctr.x, v.co.y - ctr.y)).length / rmax
        if r < 0.98: v.co.z = ZCUT + 0.03 * (1 - r * r)
    for f in capf: f.smooth = True
    for f in capf: f[capl] = 1   # the hood build (build_hood3.py) opens these again
hme = bpy.data.meshes.new('HappiHead'); bm.to_mesh(hme); bm.free()
head = bpy.data.objects.new('HappiHead', hme); sc.collection.objects.link(head)
for m in body.data.materials:
    if m and m.name != 'CoatBack': hme.materials.append(m); break
for pl in hme.polygons: pl.material_index = 0; pl.use_smooth = True
weigh(head, lambda p: {'Head': 1})

# keep the head's own sculpted face (eye and mouth bumps) well behind the face panel. Where the two nearly touch, the
# face is only drawn on top by depth bias, and iPhones (Metal) honour that bias differently: the head showed through
# the eyes, mouth and fringe there (Dapo, 2026-11-20). Every head point behind the panel's oval goes back >= FGAP.
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform
FGAP = 0.008
fme = face.data.copy(); fme.transform(face.matrix_world)
fbm = bmesh.new(); fbm.from_mesh(fme); bmesh.ops.triangulate(fbm, faces=fbm.faces[:])
fuv = fbm.loops.layers.uv.active
ftree = BVHTree.FromBMesh(fbm); fbm.faces.ensure_lookup_table()
moved = 0
for v in hme.vertices:
    p = v.co.copy()
    hit, nrm, idx, dist = ftree.ray_cast(p + Vector((0, 0.3, 0)), Vector((0, -1, 0)), 0.6)
    if hit is None: continue
    tri = fbm.faces[idx]; vs = [l.vert.co for l in tri.loops]; uvs = [l[fuv].uv.to_3d() for l in tri.loops]
    uv = barycentric_transform(hit, *vs, *uvs)
    if ((uv.x - 0.5) / 0.47) ** 2 + ((uv.y - 0.5) / 0.464) ** 2 > 1.04: continue   # outside the drawn oval: head shows
    if p.y < hit.y + FGAP:
        v.co.y = hit.y + FGAP; moved += 1
fbm.free(); bpy.data.meshes.remove(fme)
print('FACE dent moved', moved)
HEAD_Z = ZCUT

# ------------------------------------------------------------------ coat
FRONT = Vector((0, -1, 0)); UP = Vector((0, 0, 1)); XA = Vector((1, 0, 0))
GAP = 0.36            # half-angle (rad) of the open front, measured round the body from straight ahead
coat_prof = [  # z, rx, ry
    (0.195, 0.205, 0.140), (0.24, 0.200, 0.137), (0.30, 0.192, 0.132), (0.36, 0.185, 0.128), (0.42, 0.180, 0.124),
    (0.465, 0.172, 0.118), (0.50, 0.150, 0.108), (0.53, 0.120, 0.094), (0.555, 0.100, 0.082)]
N = 72
rings = [ring_pts(Vector((0, 0.004, z)), XA, FRONT, rx, ry, N, p=2.6, th0=GAP, th1=2 * math.pi - GAP, closed=False) for z, rx, ry in coat_prof]
zs = [z for z, _, _ in coat_prof]
coat = loft('HappiCoat', rings, N, closed=False, uv=lambda i, j: (i / N, (zs[j] - zs[0]) / (zs[-1] - zs[0])), solid=0.012, matl=M['coat'])
coat.data.materials.append(M['lining'])
# inside faces (the solidify copy faces inwards) get the lining colour
for pl in coat.data.polygons:
    c = pl.center; r = Vector((c.x, c.y, 0))
    if pl.normal.dot(r.normalized()) < -0.3 and abs(c.x) + abs(c.y) > 0.02: pl.material_index = 1
weigh(coat, torso_w)

# ------------------------------------------------------------------ shirt (orange, the apple on the front)
shirt_prof = [(0.255, 0.140, 0.104), (0.30, 0.150, 0.110), (0.36, 0.152, 0.112), (0.42, 0.148, 0.110), (0.48, 0.135, 0.100), (0.53, 0.105, 0.085), (0.56, 0.08, 0.07)]
NS = 48
rings = [ring_pts(Vector((0, 0.004, z)), XA, FRONT, rx, ry, NS, p=2.2) for z, rx, ry in shirt_prof]
szs = [z for z, _, _ in shirt_prof]
shirt = loft('HappiShirt', rings, NS, closed=True, cap0=True, uv=lambda i, j: (0.5 + i / NS, (szs[j] - szs[0]) / (szs[-1] - szs[0])), matl=M['shirt'])
weigh(shirt, torso_w)

# ------------------------------------------------------------------ pants: a seat under the coat, two legs
seat = ellipsoid('HappiSeat', Vector((0, 0.01, 0.285)), (0.135, 0.105, 0.075), M['navy'])
weigh(seat, lambda p: {'Hips': 1})
legs = []
for L in ('Left', 'Right'):
    a, k, f = B[L + 'UpLeg'], B[L + 'Leg'], B[L + 'Foot']
    pts = [a + (a - k).normalized() * 0.02, a, a.lerp(k, 0.5), k, k.lerp(f, 0.5), f + Vector((0, 0, 0.02))]
    rad = [0.058, 0.058, 0.056, 0.052, 0.048, 0.046]
    rings = []
    for idx, (p, r) in enumerate(zip(pts, rad)):
        t = (pts[min(idx + 1, len(pts) - 1)] - pts[max(idx - 1, 0)]).normalized()
        X = UP.cross(t).normalized() if abs(t.dot(UP)) < 0.99 else XA
        if X.length < 0.5: X = XA
        Y = t.cross(X).normalized()
        rings.append(ring_pts(p, X, Y, r, r, 32))
    lg = loft('HappiLeg' + L, rings, 32, cap0=True, cap1=True, matl=M['navy'])
    weigh(lg, chain_w([(L + 'UpLeg', a, k), (L + 'Leg', k, f)]))
    legs.append(lg)

# ------------------------------------------------------------------ sneakers: white sole, orange upper, navy laces
shoes = []
for s, L in ((1, 'Left'), (-1, 'Right')):
    ank, toe = B[L + 'Foot'], B[L + 'ToeBase']
    cx = (ank.x + toe.x) / 2 + s * 0.004
    y_heel, y_toe = ank.y + 0.062, toe.y - 0.105
    Ls = y_heel - y_toe
    def foot_ring(t, z, hw, top, rr):   # t 0 heel -> 1 toe; a rounded box section
        y = y_heel - Ls * t
        return [Vector((cx + hw * math.copysign(abs(math.sin(a)) ** 0.55, math.sin(a)), y, z + (top - z) * (0.5 + 0.5 * math.copysign(abs(math.cos(a)) ** 0.55, math.cos(a))))) for a in [i * 2 * math.pi / 32 for i in range(32)]]
    # Matches the art (Dapo, round 6: "missing the blue strings"): a low, round sneaker; thick white sole with a rim,
    # orange upper, a white rubber toe cap, and three navy laces raised on the instep.
    st = [0.0, 0.03, 0.15, 0.4, 0.7, 0.9, 0.97, 1.0]
    hw = [0.034, 0.052, 0.060, 0.059, 0.062, 0.056, 0.043, 0.006]
    sole = loft('HappiSole' + L, [foot_ring(t, 0.0, w, 0.032, 0) for t, w in zip(st, hw)], 32, cap0=True, cap1=True, matl=M['white'])
    tops = [0.100, 0.106, 0.100, 0.084, 0.066, 0.056, 0.048, 0.038]
    uw = [0.030, 0.047, 0.054, 0.053, 0.056, 0.050, 0.038, 0.005]
    up = loft('HappiShoe' + L, [foot_ring(t, 0.024, w, tp, 0) for t, w, tp in zip(st, uw, tops)], 32, cap0=True, cap1=True, matl=M['orange'])
    up.data.materials.append(M['white'])
    y_cap = y_heel - Ls * 0.74           # the toe cap starts here
    for pl in up.data.polygons:
        if pl.center.y < y_cap: pl.material_index = 1
    parts = [sole, up]
    # laces: three navy cords lying ON the upper's top surface, across the instep, a little apart
    def lerp_tab(tab, t):
        for i in range(len(st) - 1):
            if st[i] <= t <= st[i + 1]:
                k = (t - st[i]) / (st[i + 1] - st[i]); return tab[i] + (tab[i + 1] - tab[i]) * k
        return tab[-1]
    for k, t in enumerate((0.30, 0.42, 0.54)):
        w, tp = lerp_tab(uw, t), lerp_tab(tops, t)
        y = y_heel - Ls * t
        ctr = Vector((cx, y, (0.024 + tp) / 2))
        path = []
        for i in range(11):
            a = -0.6 + 1.2 * i / 10
            q = Vector((cx + w * math.copysign(abs(math.sin(a)) ** 0.55, math.sin(a)), y,
                        0.024 + (tp - 0.024) * (0.5 + 0.5 * math.copysign(abs(math.cos(a)) ** 0.55, math.cos(a)))))
            q += (q - ctr).normalized() * 0.0035
            q.y += s * 0.012 * (i - 5) / 5   # tilted like the art's strokes (outer end further back)
            path.append(q)
        rings = []
        for idx, q in enumerate(path):
            tg = (path[min(idx + 1, 10)] - path[max(idx - 1, 0)]).normalized()
            X = tg.cross(Vector((0, 1, 0))).normalized(); Y = tg.cross(X).normalized()
            rings.append(ring_pts(q, X, Y, 0.0048, 0.0038, 10))
        parts.append(loft(f'HappiLace{L}{k}', rings, 10, cap0=True, cap1=True, matl=M['navy']))
    # one object per shoe (joined), weighted heel->Foot, toe->ToeBase
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts: o.select_set(True)
    bpy.context.view_layer.objects.active = up; bpy.ops.object.join()
    up.name = 'HappiShoe' + L
    yb = toe.y
    weigh(up, lambda p, yb=yb: {L + 'Foot': 1 - ss(yb + 0.02, yb - 0.03, p.y), L + 'ToeBase': ss(yb + 0.02, yb - 0.03, p.y)})
    shoes.append(up)

# ------------------------------------------------------------------ sleeves + hands
sleeves, hands = [], []
for s, L in ((1, 'Left'), (-1, 'Right')):
    a, e, w = B[L + 'Arm'], B[L + 'ForeArm'], B[L + 'Hand']
    root = Vector((s * 0.11, a.y, a.z + 0.005))
    path = [root, a, a.lerp(e, 0.5), e, e.lerp(w, 0.45), w - (w - e).normalized() * 0.012]
    # kimono sleeve: round at the shoulder, widening to a tall boxy opening that hangs a little
    rx = [0.050, 0.058, 0.066, 0.074, 0.080, 0.084]   # across (front-back)
    ry = [0.052, 0.066, 0.084, 0.102, 0.116, 0.124]   # up-down
    drop = [0.0, 0.0, 0.012, 0.026, 0.040, 0.050]
    rings = []
    for idx, p in enumerate(path):
        t = (path[min(idx + 1, len(path) - 1)] - path[max(idx - 1, 0)]).normalized()
        Y = (UP - t * UP.dot(t)).normalized()       # "up" across the sleeve
        X = t.cross(Y).normalized()
        rings.append(ring_pts(p - Y * drop[idx], X, Y, rx[idx], ry[idx], 40, p=2.8))
    ln = [0]
    for p, q in zip(path, path[1:]): ln.append(ln[-1] + (q - p).length)
    sl = loft('HappiSleeve' + L, rings, 40, uv=lambda i, j: (i / 40, 1 - ln[j] / ln[-1]), solid=0.01, matl=M['sleeve'])
    sl.data.materials.append(M['lining'])
    sw = chain_w([('Spine', Vector((0, a.y, a.z)), root), (L + 'Arm', a, e), (L + 'ForeArm', e, w)])
    weigh(sl, sw)
    sleeves.append(sl)
    d = (w - e).normalized()
    hd = ellipsoid('HappiHand' + L, w + d * 0.036, (0.056, 0.054, 0.056), M['white'], 32, 20)
    th = ellipsoid('HappiThumb' + L, w + d * 0.016 + Vector((0, -0.04, 0.014)), (0.021, 0.021, 0.026), M['white'], 16, 10)
    bpy.ops.object.select_all(action='DESELECT'); hd.select_set(True); th.select_set(True)
    bpy.context.view_layer.objects.active = hd; bpy.ops.object.join(); hd.name = 'HappiHand' + L
    weigh(hd, lambda p, L=L: {L + 'Hand': 1})
    hands.append(hd)

bpy.data.objects.remove(body)
NEW = [head, coat, shirt, seat] + legs + shoes + sleeves + hands
print('PARTS', [(o.name, len(o.data.vertices)) for o in NEW])

# ------------------------------------------------------------------ re-bake the clips: arms out, not up into the head
arm.data.pose_position = 'POSE'
pb = arm.pose.bones
rest_chest = (arm.matrix_world @ arm.data.bones['Spine'].matrix_local).to_3x3().normalized()
def chest_axes():
    m = (arm.matrix_world @ pb['Spine'].matrix).to_3x3().normalized()
    R = m @ rest_chest.inverted()
    return R @ XA, R @ FRONT, R @ UP

def clamp_dir(d, side, o, f, u, emax, push):
    ox = d.dot(o) * side; fy = d.dot(f); uz = d.dot(u)
    e = math.asin(max(-1, min(1, uz)))
    h = math.hypot(ox, fy)
    if h < 1e-4: ox, fy, h = 1.0, 0.0, 1.0
    ox /= h; fy /= h
    if e > 0:
        req = push * min(1.0, e / emax)
        if ox < req:   # push outward, keeping the front/back share continuous (no flip when fy crosses zero)
            ox = req + (ox - req) * 0.0; nn = math.hypot(ox, fy); ox /= nn; fy /= nn
    k = emax * 0.55
    if e > k: e = k + (emax - k) * math.tanh((e - k) / (emax - k))
    return (o * side * ox + f * fy) * math.cos(e) + u * math.sin(e)

def rotate_bone(name, d_from, d_to):
    p = pb[name]
    q = d_from.rotation_difference(d_to)
    h = arm.matrix_world @ p.head
    W = arm.matrix_world @ p.matrix
    W2 = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ W
    p.matrix = arm.matrix_world.inverted() @ W2
    bpy.context.view_layer.update()

KEEP_BEND = {'bow', 'sleep', 'wakeUp'}
def swing_only(q):
    q = q.normalized(); tw = Quaternion((q.w, 0, q.y, 0))
    if tw.magnitude < 1e-6: return q
    return q @ tw.normalized().inverted()
NUDGE = [0]
rest_hips = (arm.matrix_world @ arm.data.bones['Hips'].matrix_local).to_3x3().normalized()
rest_of = {n: (arm.matrix_world @ arm.data.bones[n].matrix_local).to_3x3().normalized() for n in ('Spine', 'Head')}
clips = [st.action for t in ad.nla_tracks for st in t.strips if st.action]
for act in clips:
    ad.action = act
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    for b in pb: b.rotation_mode = 'QUATERNION'
    for fr in range(f0, f1 + 1):
        sc.frame_set(fr)
        if act.name not in KEEP_BEND:
            # stand up straight: take most of the clip's forward hunch out of the spine, half of the head's nod
            hips = (arm.matrix_world @ pb['Hips'].matrix).to_3x3().normalized() @ rest_hips.inverted()
            fh = hips @ FRONT; fh.z = 0
            fh = fh.normalized() if fh.length > 1e-4 else FRONT
            for bn, meas, keep in (('Spine02', 'Spine', 0.3), ('neck', 'Head', 0.5)):
                R = (arm.matrix_world @ pb[meas].matrix).to_3x3().normalized() @ rest_of[meas].inverted()
                uu = R @ UP
                t = math.atan2(uu.dot(fh), uu.dot(UP))
                side = uu - fh * uu.dot(fh) - UP * uu.dot(UP)
                t2 = t * keep if t > 0 else t * (0.6 if bn == 'Spine02' else 1)
                u2 = (fh * math.sin(t2) + UP * math.cos(t2)) * math.sqrt(max(0, 1 - side.length_squared)) + side
                rotate_bone(bn, uu, u2.normalized())
                pb[bn].keyframe_insert('rotation_quaternion', frame=fr)
        o, f, u = chest_axes()
        for s, L in ((1, 'Left'), (-1, 'Right')):
            A, F, H = pb[L + 'Arm'], pb[L + 'ForeArm'], pb[L + 'Hand']
            pa, pf, ph = (arm.matrix_world @ A.head), (arm.matrix_world @ F.head), (arm.matrix_world @ H.head)
            d_up0, d_fo0 = (pf - pa).normalized(), (ph - pf).normalized()
            rotate_bone(L + 'Arm', d_up0, clamp_dir(d_up0, s, o, f, u, math.radians(28), 0.75))
            pf2, ph2 = arm.matrix_world @ F.head, arm.matrix_world @ H.head
            rotate_bone(L + 'ForeArm', (ph2 - pf2).normalized(), clamp_dir(d_fo0, s, o, f, u, math.radians(42), 0.7))
            # the head leans with the body; keep the hand out of the head whatever the lean (world up check)
            ow = Vector((o.x, o.y, 0)).normalized(); fw = UP.cross(ow) * -1
            for bn, emax, push in ((L + 'Arm', 34, 0.7), (L + 'ForeArm', 48, 0.65)):
                P = pb[bn]; ch = pb[bn].children[0]
                h0, h1 = arm.matrix_world @ P.head, arm.matrix_world @ ch.head
                dd = (h1 - h0).normalized()
                rotate_bone(bn, dd, clamp_dir(dd, s, ow, fw, UP, math.radians(emax), push))
            # last check, by position: the hand (with its sleeve) must stay outside the head's outline seen from the front.
            # Measured in the head's rest frame, so nods and leans count. If it's inside, swing the upper arm out.
            Hr = arm.matrix_world @ arm.data.bones['Head'].matrix_local
            def inside():
                Hm = arm.matrix_world @ pb['Head'].matrix
                q = Hr @ Hm.inverted() @ (arm.matrix_world @ H.head)
                return (q.x / 0.42) ** 2 + ((q.z - 0.71) / 0.17) ** 2, q   # bottom edge 0.54: hands under the chin are fine
            v, q = inside(); tries = 0
            while v < 1 and tries < 30:
                o2, f2, u2 = chest_axes()
                pa = arm.matrix_world @ A.head; pf = arm.matrix_world @ F.head
                d0 = (pf - pa).normalized()
                # swing direction fixed by geometry (the one that moves the hand outward), so it can't flip between frames
                r = (arm.matrix_world @ H.head) - pa
                sg = 1 if f2.cross(r).dot(o2 * s) > 0 else -1
                rotate_bone(L + 'Arm', d0, Quaternion(f2, sg * math.radians(3)) @ d0)
                v, q = inside(); tries += 1
            if tries: NUDGE[0] += 1
            # drop the twist the corrections pile up (minimal-arc turns near 180 degrees spin the bone round its own axis,
            # which pops the sleeve and thumb): keep each bone's direction, take its roll from the rest pose
            ph_keep = arm.matrix_world @ H.head
            A.rotation_quaternion = swing_only(A.rotation_quaternion); bpy.context.view_layer.update()
            pf3 = arm.matrix_world @ F.head
            rotate_bone(L + 'ForeArm', ((arm.matrix_world @ H.head) - pf3).normalized(), (ph_keep - pf3).normalized())
            F.rotation_quaternion = swing_only(F.rotation_quaternion); bpy.context.view_layer.update()
            A.keyframe_insert('rotation_quaternion', frame=fr); F.keyframe_insert('rotation_quaternion', frame=fr)
    # soften the per-frame corrections (the nudge works in 5 degree steps): a light 1-2-1 filter on the arm keys
    for bn in ('LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm'):
        fcs = [act.fcurves.find(f'pose.bones["{bn}"].rotation_quaternion', index=i) for i in range(4)]
        if not all(fcs): continue
        kp = [fc.keyframe_points for fc in fcs]
        n = len(kp[0])
        if n < 3 or any(len(k) != n for k in kp): continue
        Q = [Quaternion([kp[i][j].co[1] for i in range(4)]) for j in range(n)]
        for j in range(1, n):
            if Q[j].dot(Q[j - 1]) < 0: Q[j].negate()
        for _ in range(4):
            Q = [Q[0]] + [Quaternion([(Q[j - 1][i] + 2 * Q[j][i] + Q[j + 1][i]) / 4 for i in range(4)]).normalized() for j in range(1, n - 1)] + [Q[-1]]
        for j in range(n):
            for i in range(4): kp[i][j].co[1] = Q[j][i]; kp[i][j].handle_left[1] = kp[i][j].handle_right[1] = Q[j][i]
    print('BAKED', act.name, f1 - f0 + 1, 'nudged', NUDGE[0]); NUDGE[0] = 0
ad.action = None
for t in ad.nla_tracks: t.mute = False

# ------------------------------------------------------------------ export
bpy.ops.object.select_all(action='DESELECT')
for o in [arm, face, tail] + NEW: o.select_set(True)
bpy.context.view_layer.objects.active = arm
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True,
    export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=True,
    export_anim_single_armature=True, export_reset_pose_bones=True, export_skins=True, export_all_influences=False,
    export_def_bones=False, export_image_format='WEBP', export_image_quality=90, export_yup=True, export_apply=False,
    export_cameras=False, export_lights=False)
bpy.ops.wm.save_as_mainfile(filepath=OUT.replace('.glb', '.blend'), compress=True)
print('EXPORTED', OUT, os.path.getsize(OUT))
