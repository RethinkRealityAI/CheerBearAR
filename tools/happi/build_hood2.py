# The selfie hood from the real Happi model (Dapo, 2026-11-20: "exactly like the actual 3D model's hood", with a
# vertical oval opening). Rest pose, head of HappiBody above the chin, the face cut as a vertical oval sized for a
# human face, a little thickness, decimated, scaled to face units (FU) with the opening centre at the origin.
# Out: public/models/happi-hood.glb (three: front = +z; face-fx turns it to face down -z).
import bpy, bmesh, sys, mathutils
argv = sys.argv[sys.argv.index('--') + 1:]
BLEND, OUT = argv[0], argv[1]
OPEN_FU = (0.54, 0.74)  # opening half-width / half-height in FU (the old code hood's, sized on real faces)
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
s = OPEN_FU[1] / (half_h * 0.92)      # FU per model unit: the opening fills 92% of the panel's height
ox, oz = OPEN_FU[0] / s, OPEN_FU[1] / s
neck = fmin.z - 0.015
# a fresh mesh of the evaluated body, then cut
body = bpy.data.objects['HappiBody']
eb = body.evaluated_get(dg)
me = bpy.data.meshes.new_from_object(eb, depsgraph=dg)
me.transform(body.matrix_world)
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)  # glTF splits verts on UV seams: weld so pieces connect
kill = [f for f in bm.faces if f.calc_center_median().z < neck]
bmesh.ops.delete(bm, geom=kill, context='FACES')
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
me.materials.append(white); me.materials.append(inner)
bpy.ops.object.select_all(action='DESELECT')
fob.select_set(True); ob.select_set(True); bpy.context.view_layer.objects.active = ob
bpy.ops.object.join()
# the opening: a clean vertical oval cut (boolean with an elliptic cylinder through the front only)
bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=1, depth=0.5, location=(fc.x, fc.y - 0.1, fc.z), rotation=(1.5708, 0, 0))
cut = bpy.context.active_object
cut.scale = (ox, oz, 1)
cut.data.materials.append(inner)
bpy.context.view_layer.objects.active = ob
bo = ob.modifiers.new('cut', 'BOOLEAN'); bo.operation = 'DIFFERENCE'; bo.object = cut; bo.solver = 'EXACT'; bo.material_mode = 'TRANSFER'
bpy.ops.object.modifier_apply(modifier='cut')
bpy.data.objects.remove(cut)
ob.select_set(True)
# origin at the opening centre, face units
me.transform(mathutils.Matrix.Translation(-fc))
me.transform(mathutils.Matrix.Scale(s, 4))
dec = ob.modifiers.new('dec', 'DECIMATE'); dec.ratio = 0.6
sol = ob.modifiers.new('sol', 'SOLIDIFY'); sol.thickness = 0.06; sol.offset = -1; sol.use_rim = True; sol.material_offset = 2; sol.material_offset_rim = 2
bpy.ops.object.modifier_apply(modifier='dec'); bpy.ops.object.modifier_apply(modifier='sol')
bpy.ops.object.shade_smooth()
for img in bpy.data.images:
    if img.size[0] > 1024: img.scale(1024, 1024)
print('tris', sum(len(p.vertices) - 2 for p in me.polygons), 'scale FU/unit', s, 'dims FU', tuple(ob.dimensions))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_image_format='WEBP',
    export_image_quality=86, export_yup=True, export_apply=True, export_animations=False, export_skins=False,
    export_cameras=False, export_lights=False)
print('EXPORTED', OUT)
