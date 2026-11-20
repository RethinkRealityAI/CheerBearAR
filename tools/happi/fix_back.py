# Dapo 2026-11-20: the coat's back showed the front (Meshy mirrored the open coat + NYC tee onto the back). Paint the
# back of the coat a closed, plain navy: body faces facing backwards between the hem and the neck get a flat navy
# material. Re-exports happi.glb with build_happi.py's settings.
import bpy, bmesh, sys, mathutils, os
argv = sys.argv[sys.argv.index('--') + 1:]
BLEND, OUT = argv[0], argv[1]
Z0, Z1, XW, NY = float(argv[2]), float(argv[3]), float(argv[4]), float(argv[5])
bpy.ops.wm.open_mainfile(filepath=BLEND)
body = bpy.data.objects['HappiBody']
arm = bpy.data.objects['Happi']
mw = body.matrix_world
navy = bpy.data.materials.get('CoatBack') or bpy.data.materials.new('CoatBack')
navy.use_nodes = True
b = navy.node_tree.nodes['Principled BSDF']
b.inputs['Base Color'].default_value = (0.021, 0.042, 0.27, 1)
b.inputs['Roughness'].default_value = 0.75
if 'Specular IOR Level' in b.inputs: b.inputs['Specular IOR Level'].default_value = 0.3
if navy.name not in [m.name for m in body.data.materials if m]: body.data.materials.append(navy)
mi = [m.name if m else '' for m in body.data.materials].index(navy.name)
# bounds of the body to find its centre line (rest pose)
ys = [(mw @ v.co).y for v in body.data.vertices]
cy = (min(ys) + max(ys)) / 2
n = 0
nm = mw.to_3x3()
for p in body.data.polygons:
    c = mw @ p.center
    nrm = (nm @ p.normal).normalized()
    if Z0 < c.z < Z1 and abs(c.x) < XW and nrm.y > NY and c.y > cy - 0.02:
        p.material_index = mi; n += 1
print('painted', n, 'faces navy; centre y', cy)
for o in bpy.data.objects: o.select_set(o.type in ('ARMATURE', 'MESH'))
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True,
    export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=True,
    export_anim_single_armature=True, export_reset_pose_bones=True, export_skins=True, export_all_influences=False,
    export_def_bones=False, export_image_format='WEBP', export_image_quality=88, export_yup=True, export_apply=False,
    export_cameras=False, export_lights=False)
bpy.ops.wm.save_as_mainfile(filepath=OUT.replace('.glb', '.blend'), compress=True)
print('EXPORTED', OUT, os.path.getsize(OUT))
