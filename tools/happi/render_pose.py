import bpy, sys, json, mathutils
from bpy_extras.object_utils import world_to_camera_view
argv=sys.argv[sys.argv.index('--')+1:]
blend, clip, frame, out = argv[0], argv[1], float(argv[2]), argv[3]
bpy.ops.wm.open_mainfile(filepath=blend)
sc=bpy.context.scene
arm=bpy.data.objects['Happi']
ad=arm.animation_data
for t in ad.nla_tracks: t.mute = t.name!=clip
st=[t for t in ad.nla_tracks if t.name==clip][0].strips[0]
sc.frame_set(int(st.frame_start+frame*(st.frame_end-st.frame_start)))
dg=bpy.context.evaluated_depsgraph_get()
meshes=[o for o in sc.objects if o.type=='MESH' and not o.hide_render]
mn=mathutils.Vector((1e9,)*3); mx=-mn
for o in meshes:
    e=o.evaluated_get(dg); me=e.to_mesh()
    for v in me.vertices:
        w=e.matrix_world@v.co; mn=mathutils.Vector(map(min,mn,w)); mx=mathutils.Vector(map(max,mx,w))
    e.to_mesh_clear()
print('BBOX',tuple(mn),tuple(mx))
H=mx.z-mn.z; W=mx.x-mn.x
res_y=int(argv[4]) if len(argv)>4 else 2000; res_x=int(res_y*(W*1.06)/(H*1.04))
sc.render.engine='CYCLES'; sc.cycles.samples=48; sc.cycles.device='CPU'; sc.cycles.use_denoising=True
w=bpy.data.worlds.new('w'); sc.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[0].default_value=(1,1,1,1); w.node_tree.nodes['Background'].inputs[1].default_value=0.85
sun=bpy.data.objects.new('sun',bpy.data.lights.new('sun','SUN')); sun.data.energy=2.2; sun.rotation_euler=(1.2,0,0.35); sc.collection.objects.link(sun)
sc.render.film_transparent=True
sc.render.resolution_x=res_x; sc.render.resolution_y=res_y; sc.render.resolution_percentage=100
sc.view_settings.view_transform='Standard'
cam=bpy.data.objects.new('cam',bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera=cam
cam.data.type='ORTHO'; cam.data.ortho_scale=H*1.04
ctr=(mn+mx)/2
cam.location=(ctr.x, mn.y-5, ctr.z); cam.rotation_euler=(1.5708,0,0)
face=bpy.data.objects.get('HappiFace')
fb=None
if face:
    e=face.evaluated_get(dg); me=e.to_mesh()
    pts=[world_to_camera_view(sc,cam,e.matrix_world@v.co) for v in me.vertices]
    e.to_mesh_clear()
    xs=[p.x for p in pts]; ys=[p.y for p in pts]
    fb={'x0':min(xs),'x1':max(xs),'y0':min(ys),'y1':max(ys)}
sc.render.filepath=out
bpy.ops.render.render(write_still=True)
json.dump({'face':fb,'H':H,'W':W,'res':[res_x,res_y]},open(out.replace('.png','.json'),'w'))
print('DONE',fb)
