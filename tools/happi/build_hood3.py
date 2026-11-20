# Round 6 (Dapo 2026-11-20: "the same one Happi has... copy that to be used as the selfie prop", no fur, not torn or
# decimated, a little taller to cover the chin): built from the rebuilt model's HappiHead (seams welded, underside
# capped by tools/happi/build_body.py), the cap opened again for the neck, a short collar run down past the chin,
# NO decimation and the texture at full size. hood.ts draws it with Happi's own material.
# usage: python build_hood3.py -- happi-v7.blend public/models/happi-hood.glb [open_w open_h fill drop collar]
#
# (round 5 notes) The selfie hood from the real Happi model (Dapo, 2026-11-20: "exactly like the actual 3D model's hood", with a
# vertical oval opening). Rest pose, head of HappiBody above the chin, the face cut as a vertical oval sized for a
# human face, a little thickness, decimated, scaled to face units (FU) with the opening centre at the origin.
# Out: public/models/happi-hood.glb (three: front = +z; face-fx turns it to face down -z).
import bpy, bmesh, sys, mathutils
argv = sys.argv[sys.argv.index('--') + 1:]
BLEND, OUT = argv[0], argv[1]
# opening half-width / half-height in FU at build scale, how much of the panel's height it fills, and how far its
# centre drops (in panel half-heights). Round 5 (Dapo): a wider, longer oval that shows the whole face and chin; the
# runtime then draws the hood 15% narrower and taller (src/happi/hood.ts HOOD_SCALE).
OPEN_FU = (float(argv[2]), float(argv[3])) if len(argv) > 3 else (0.77, 0.80)
FILL = float(argv[4]) if len(argv) > 4 else 1.0
DROP = float(argv[5]) if len(argv) > 5 else 0.05
COLLAR = float(argv[6]) if len(argv) > 6 else 0.05   # model units the hood runs on below the head (covers the chin)
bpy.ops.wm.open_mainfile(filepath=BLEND)
sc = bpy.context.scene
arm = bpy.data.objects['Happi']
arm.data.pose_position = 'REST'
if arm.animation_data:
    arm.animation_data.action = None
    for t in arm.animation_data.nla_tracks: t.mute = True
sc.frame_set(0)
dg = bpy.context.evaluated_depsgraph_get()
def world_verts(name):
    o = bpy.data.objects[name].evaluated_get(dg)
    me = o.to_mesh()
    vs = [o.matrix_world @ v.co for v in me.vertices]
    o.to_mesh_clear()
    return vs
fv = world_verts('HappiFace')
fmin = mathutils.Vector([min(v[i] for v in fv) for i in range(3)])
fmax = mathutils.Vector([max(v[i] for v in fv) for i in range(3)])
fc = (fmin + fmax) / 2
print('face panel', tuple(fmin), tuple(fmax))
half_h = (fmax.z - fmin.z) / 2
s = OPEN_FU[1] / (half_h * FILL)      # FU per model unit: the opening fills FILL of the panel's height
ox, oz = OPEN_FU[0] / s, OPEN_FU[1] / s
neck = fmin.z - 0.015
# the rebuilt head (already welded; its capped underside is opened again for the neck)
body = bpy.data.objects['HappiHead']
eb = body.evaluated_get(dg)
me = bpy.data.meshes.new_from_object(eb, depsgraph=dg)
me.transform(body.matrix_world)
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
zb = min(v.co.z for v in bm.verts)
capl = bm.faces.layers.int.get('neck_cap')
cap = [f for f in bm.faces if capl and f[capl]]
print('neck cap faces', len(cap))
bmesh.ops.delete(bm, geom=cap, context='FACES'); cap = []
# the scan's neck is crumpled for the first few cm above the cut (the coat hid it on Happi): cut it off cleanly
RIM = 0.03
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, zb + RIM), plane_no=(0, 0, 1), clear_inner=True)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
zb += RIM
bmesh.ops.delete(bm, geom=cap, context='FACES')
# a short collar: the open lower edge runs down and a little in, so the hood reaches past a real chin
for _ in range(2 if COLLAR > 0 else 0):
    edge = [e for e in bm.edges if e.is_boundary and all(v.co.z < zb + 0.04 for v in e.verts)]
    if not edge: break
    ex = bmesh.ops.extrude_edge_only(bm, edges=edge)
    nv = [g for g in ex['geom'] if isinstance(g, bmesh.types.BMVert)]
    cx = sum((v.co.x for v in nv)) / len(nv); cy = sum((v.co.y for v in nv)) / len(nv)
    for v in nv:
        v.co.z -= COLLAR / 2
        v.co.x = cx + (v.co.x - cx) * 0.95; v.co.y = cy + (v.co.y - cy) * 0.95
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])   # extruded faces can come out flipped
# Happi's white face: the body's own panel area is bumpy and has stray scan paint, so it goes, and the smooth fitted
# panel (HappiFace, a few mm proud of the body) takes its place in plain white
pw, ph = (fmax.x - fmin.x) / 2 * 0.94, (fmax.z - fmin.z) / 2 * 0.94
gone = [f for f in bm.faces if f.calc_center_median().y < fc.y + 0.08 and ((f.calc_center_median().x - fc.x) / pw) ** 2 + ((f.calc_center_median().z - fc.z) / ph) ** 2 < 1]
bmesh.ops.delete(bm, geom=gone, context='FACES')
loose = [v for v in bm.verts if not v.link_faces]
bmesh.ops.delete(bm, geom=loose, context='VERTS')
# keep only the biggest connected piece (drops crumbs)
bm.verts.ensure_lookup_table()
seen = set(); parts = []
for v in bm.verts:
    if v in seen: continue
    stack = [v]; part = []; seen.add(v)
    while stack:
        x = stack.pop(); part.append(x)
        for e in x.link_edges:
            o2 = e.other_vert(x)
            if o2 not in seen: seen.add(o2); stack.append(o2)
    parts.append(part)
parts.sort(key=len, reverse=True)
for p in parts[1:]: bmesh.ops.delete(bm, geom=p, context='VERTS')
# the bottom rim and the collar: Happi's flat orange (the scan painted navy coat streaks round the neck)
for f in bm.faces:
    if all(v.co.z < zb + 0.004 for v in f.verts): f.material_index = 3
bm.to_mesh(me); bm.free()
ob = bpy.data.objects.new('HappiHood', me); sc.collection.objects.link(ob)
fo = bpy.data.objects['HappiFace']
fme = bpy.data.meshes.new_from_object(fo.evaluated_get(dg), depsgraph=dg)
fme.transform(fo.matrix_world)
fme.materials.clear()
fbm = bmesh.new(); fbm.from_mesh(fme)
for f in fbm.faces: f.material_index = 1
fbm.to_mesh(fme); fbm.free()
fob = bpy.data.objects.new('Panel', fme); sc.collection.objects.link(fob)
for o in list(sc.objects):
    if o is not ob and o is not fob: bpy.data.objects.remove(o)
def flat(name, rgb):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = 0.85
    return m
white = flat('HoodFace', (1.0, 0.93, 0.86))
inner = flat('HoodInside', (0.69, 0.11, 0.008))
while len(me.materials) < 1: me.materials.append(None)
# the head's own orange: the median of the orange texels of its texture
import numpy as np
orange = (0.84, 0.32, 0.06)
for m in me.materials:
    if m and m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                px = np.array(n.image.pixels[:]).reshape(-1, 4)[:, :3]
                sel = px[(px[:, 0] > 0.5) & (px[:, 1] > 0.12) & (px[:, 1] < 0.45) & (px[:, 2] < 0.15)]
                if len(sel) > 100: orange = tuple(float(((x + 0.055) / 1.055) ** 2.4) for x in np.median(sel, axis=0))  # sRGB -> linear
print('orange (linear)', orange)
me.materials.append(white); me.materials.append(inner); me.materials.append(flat('HoodOrange', orange))
bpy.ops.object.select_all(action='DESELECT')
fob.select_set(True); ob.select_set(True); bpy.context.view_layer.objects.active = ob
bpy.ops.object.join()
# the opening: a clean vertical oval cut (boolean with an elliptic cylinder through the front only)
bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=1, depth=0.5, location=(fc.x, fc.y - 0.1, fc.z - DROP * half_h), rotation=(1.5708, 0, 0))
cut = bpy.context.active_object
cut.scale = (ox, oz, 1)
cut.data.materials.append(inner)
bpy.context.view_layer.objects.active = ob
bo = ob.modifiers.new('cut', 'BOOLEAN'); bo.operation = 'DIFFERENCE'; bo.object = cut; bo.solver = 'EXACT'; bo.use_hole_tolerant = True; bo.material_mode = 'TRANSFER'
bpy.ops.object.modifier_apply(modifier='cut')
bpy.data.objects.remove(cut)
ob.select_set(True)
# origin at the opening centre, face units
me.transform(mathutils.Matrix.Translation(-fc))
me.transform(mathutils.Matrix.Scale(s, 4))
sol = ob.modifiers.new('sol', 'SOLIDIFY'); sol.thickness = 0.06; sol.offset = -1; sol.use_rim = True; sol.material_offset = 2; sol.material_offset_rim = 2
bpy.ops.object.modifier_apply(modifier='sol')
bpy.ops.object.shade_smooth()
# texture kept at its full size (round 5 shrank it to 1024 and decimated: Dapo saw it as torn and blurry)
print('tris', sum(len(p.vertices) - 2 for p in me.polygons), 'scale FU/unit', s, 'dims FU', tuple(ob.dimensions))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_image_format='WEBP',
    export_image_quality=92, export_yup=True, export_apply=True, export_animations=False, export_skins=False,
    export_cameras=False, export_lights=False)
print('EXPORTED', OUT)
