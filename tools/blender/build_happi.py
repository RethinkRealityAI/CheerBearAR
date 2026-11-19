# Build public/models/happi.glb from the Meshy rig + clips: one armature, one textured body, a code-built tail
# (metaball blob, 3 tail bones for sway), a face panel mesh (planar UV, drawn live in three.js), named NLA clips.
import bpy, bmesh, numpy as np, mathutils, math, sys, os
W='/home/user/happi-work/v2/'
OUT=sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else '/home/user/happi-work/out/happi.glb'
bpy.ops.wm.read_factory_settings(use_empty=True)
sc=bpy.context.scene; sc.render.fps=30

def imp(path):
    before=set(bpy.data.objects); acts=set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before], [a for a in bpy.data.actions if a not in acts]

objs,_=imp(W+'rigged.glb')
arm=[o for o in objs if o.type=='ARMATURE'][0]; body=[o for o in objs if o.type=='MESH' and o.parent==arm][0]
for o in objs:
    if o.type=='MESH' and o!=body: bpy.data.objects.remove(o)
for a in list(bpy.data.actions): bpy.data.actions.remove(a)
arm.name='Happi'; body.name='HappiBody'

CLIPS={'Idle':'idle','Talk_with_Hands_Open':'talkIdle','Big_Wave_Hello':'wave','FunnyDancing_01':'dance',
 'Cheer_with_Both_Hands_Up':'cheer','Happy_Sway_Standing':'sway','Formal_Bow':'bow','Dozing_Elderly':'sleep',
 'Arise':'wakeUp','Happy_jump_f':'jump','Confused_Scratch':'scratch','Victory_Fist_Pump':'fistPump',
 'Pod_Baby_Groove':'groove','Wave_One_Hand':'waveSmall',
 'Big_Heart_Gesture':'love','Cherish_Pop_Dance':'popDance','Joyful_Dance_with_Hand_Sway':'joyDance',
 'Motivational_Cheer':'cheer2','Shrug':'shrug','victory':'victory'}
clips={}
def take(path, fixed=None):
    o,acts=imp(path)
    for a in acts:
        key=fixed
        if not key:
            base=a.name.rsplit('_Armature',1)[0]
            key=CLIPS.get(base)
        if key: a.name=key; a.use_fake_user=True; clips[key]=a
        else: bpy.data.actions.remove(a)
    for x in o: bpy.data.objects.remove(x, do_unlink=True)
take(W+'anims-a.glb'); take(W+'anims-b.glb'); take(W+'anims-c.glb'); take(W+'walk.glb','walk'); take(W+'run.glb','run')
print('CLIPS',sorted(clips))

# in-place: drop horizontal root motion on Hips (keep the bounce)
for name,a in clips.items():
    for fc in a.fcurves:
        if fc.data_path=='pose.bones["Hips"].location' and fc.array_index in (0,2):
            # glTF import: bone-local axes; flatten X and Z drift to the first key
            k0=fc.keyframe_points[0].co[1]
            for kp in fc.keyframe_points: kp.co[1]=k0; kp.handle_left[1]=k0; kp.handle_right[1]=k0

# ---- material fix (Meshy wires baseColor into emission sometimes)
for m in body.data.materials:
    nt=m.node_tree; bsdf=[n for n in nt.nodes if n.type=='BSDF_PRINCIPLED'][0]
    for l in list(nt.links):
        if l.to_node==bsdf and l.to_socket.name.startswith('Emission'): nt.links.remove(l)
    bsdf.inputs['Roughness'].default_value=0.7; bsdf.inputs['Metallic'].default_value=0.0
    if 'Specular IOR Level' in bsdf.inputs: bsdf.inputs['Specular IOR Level'].default_value=0.3

mw=body.matrix_world
bones=arm.data.bones
def bw(n): return arm.matrix_world@bones[n].head_local
HIPS=bw('Hips'); HEAD=bw('Head')

# ---- face panel: front faces inside the face ellipse, duplicated, planar UV, weighted to Head
CX,CZ,AX,AZ=0.0,0.705,0.236,0.166
img=[i for i in bpy.data.images][0]
bm=bmesh.new(); bm.from_mesh(body.data)
bm.transform(mw)
keep=set()
for f in bm.faces:
    c=f.calc_center_median(); n=f.normal
    if n.y<-0.15 and c.y<-0.05 and ((c.x-CX)/AX)**2+((c.z-CZ)/AZ)**2<=1.0: keep.add(f.index)
print('FACEPOLYS',len(keep))
bm.free()
bpy.ops.object.select_all(action='DESELECT')
dup=body.copy(); dup.data=body.data.copy(); dup.name='HappiFace'; sc.collection.objects.link(dup)
dup.parent=arm; dup.matrix_world=body.matrix_world.copy()
for mod in dup.modifiers: pass
me=dup.data
bm=bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
dw=dup.matrix_world
rm=[f for f in bm.faces if f.index not in keep]
bmesh.ops.delete(bm, geom=rm, context='FACES')
# push out 3 mm along normals (in world metres -> local)
s=dw.to_scale()[0]
bm.normal_update()
for v in bm.verts: v.co+=v.normal*(0.003/s)
uvl=bm.loops.layers.uv.active
for f in bm.faces:
    for l in f.loops:
        w=dw@l.vert.co
        l[uvl].uv=((w.x-(CX-AX))/(2*AX), (w.z-(CZ-AZ))/(2*AZ))
bm.to_mesh(me); bm.free()
# keep only Head weights
for vg in list(dup.vertex_groups):
    if vg.name!='Head': dup.vertex_groups.remove(vg)
hg=dup.vertex_groups.get('Head') or dup.vertex_groups.new(name='Head')
hg.add(list(range(len(me.vertices))),1.0,'REPLACE')
fm=bpy.data.materials.new('HappiFace'); fm.use_nodes=True
fb=fm.node_tree.nodes['Principled BSDF']; fb.inputs['Base Color'].default_value=(1,1,1,1); fb.inputs['Roughness'].default_value=0.75
me.materials.clear(); me.materials.append(fm)
print('FACEVERTS',len(me.vertices))

# ---- tail: metaball blob along a curl behind the hips, on the character's left (+x)
co=np.array([(mw@v.co)[:] for v in body.data.vertices])
band=co[(abs(co[:,2]-HIPS.z)<0.05)&(abs(co[:,0])<0.12)]
back=band[:,1].max()
print('HIPS',HIPS[:],'BACK',back)
P=[(0.03,back-0.03,HIPS.z-0.02,0.05),(0.08,back+0.08,HIPS.z-0.02,0.075),(0.14,back+0.17,HIPS.z+0.06,0.1),
   (0.17,back+0.21,HIPS.z+0.18,0.125),(0.17,back+0.2,HIPS.z+0.31,0.14),(0.15,back+0.15,HIPS.z+0.42,0.13),
   (0.12,back+0.08,HIPS.z+0.48,0.1),(0.1,back+0.03,HIPS.z+0.47,0.07)]
mb=bpy.data.metaballs.new('TailMB'); mb.resolution=0.012; mb.threshold=0.6
mbo=bpy.data.objects.new('TailMB',mb); sc.collection.objects.link(mbo)
pts=[]
for i in range(len(P)-1):
    a=mathutils.Vector(P[i][:3]); b=mathutils.Vector(P[i+1][:3])
    for t in np.linspace(0,1,4,endpoint=False):
        r=P[i][3]+(P[i+1][3]-P[i][3])*t; pts.append(a.lerp(b,t))
        e=mb.elements.new(); e.co=a.lerp(b,t); e.radius=r*1.55
e=mb.elements.new(); e.co=mathutils.Vector(P[-1][:3]); e.radius=P[-1][3]*1.55
bpy.context.view_layer.objects.active=mbo; mbo.select_set(True)
bpy.context.view_layer.update()
dg=bpy.context.evaluated_depsgraph_get()
tme=bpy.data.meshes.new_from_object(mbo.evaluated_get(dg))
tail=bpy.data.objects.new('HappiTail',tme); sc.collection.objects.link(tail)
bpy.data.objects.remove(mbo)
bpy.ops.object.select_all(action='DESELECT'); tail.select_set(True); bpy.context.view_layer.objects.active=tail
dec=tail.modifiers.new('d','DECIMATE'); dec.ratio=max(0.05,min(1.0,4000/max(1,len(tme.polygons))))
bpy.ops.object.modifier_apply(modifier='d')
for p in tail.data.polygons: p.use_smooth=True
print('TAILPOLYS',len(tail.data.polygons))
# orange sampled from the hood (mode of orange-ish pixels)
pxs=np.array(img.pixels[:],dtype=np.float32).reshape(-1,4)[::7]
orange=pxs[(pxs[:,0]>0.6)&(pxs[:,1]>0.2)&(pxs[:,1]<0.55)&(pxs[:,2]<0.25)]
oc=np.median(orange,0); oc=np.where(oc<=0.04045,oc/12.92,((oc+0.055)/1.055)**2.4); print('ORANGE',oc)
tm=bpy.data.materials.new('HappiTail'); tm.use_nodes=True
tb=tm.node_tree.nodes['Principled BSDF']; tb.inputs['Base Color'].default_value=(float(oc[0]),float(oc[1]),float(oc[2]),1); tb.inputs['Roughness'].default_value=0.75
tail.data.materials.append(tm)
# tail bones
bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); bpy.context.view_layer.objects.active=arm
bpy.ops.object.mode_set(mode='EDIT')
eb=arm.data.edit_bones; inv=arm.matrix_world.inverted()
chain=[P[0][:3],P[2][:3],P[4][:3],P[7][:3]]
prev=eb['Hips']
for i in range(3):
    b=eb.new(f'Tail{i+1}'); b.head=inv@mathutils.Vector(chain[i]); b.tail=inv@mathutils.Vector(chain[i+1]); b.parent=prev; b.use_connect=(i>0); prev=b
bpy.ops.object.mode_set(mode='OBJECT')
# skin tail: weights by distance to the 3 segments
tail.parent=arm; tail.matrix_parent_inverse=arm.matrix_world.inverted()
segs=[(mathutils.Vector(chain[i]),mathutils.Vector(chain[i+1])) for i in range(3)]
vgs=[tail.vertex_groups.new(name=f'Tail{i+1}') for i in range(3)]
for v in tail.data.vertices:
    p=tail.matrix_world@v.co; ds=[]
    for a,b in segs:
        ab=b-a; t=max(0,min(1,(p-a).dot(ab)/ab.length_squared)); ds.append((p-(a+ab*t)).length)
    ws=[1/(d+0.02)**4 for d in ds]; S=sum(ws)
    for g,w in zip(vgs,ws):
        if w/S>0.02: g.add([v.index],w/S,'REPLACE')
md=tail.modifiers.new('Armature','ARMATURE'); md.object=arm
md2=dup.modifiers.get('Armature') or dup.modifiers.new('Armature','ARMATURE'); md2.object=arm

# ---- strip Meshy leftovers (icosphere, baselayer action)
for o in list(bpy.data.objects):
    if o not in (arm,body,dup,tail): bpy.data.objects.remove(o)
for a in list(bpy.data.actions):
    if a not in clips.values(): bpy.data.actions.remove(a)
# ---- NLA tracks, one per clip
arm.animation_data_create(); ad=arm.animation_data; ad.action=None
for name,a in sorted(clips.items()):
    tr=ad.nla_tracks.new(); tr.name=name
    st=tr.strips.new(name,int(a.frame_range[0]),a); tr.mute=False
os.makedirs(os.path.dirname(OUT),exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
for o in (arm,body,dup,tail): o.select_set(True)
bpy.context.view_layer.objects.active=arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True,
    export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=True,
    export_anim_single_armature=True, export_reset_pose_bones=True, export_skins=True, export_all_influences=False,
    export_def_bones=False, export_image_format='WEBP', export_image_quality=88, export_yup=True, export_apply=False,
    export_cameras=False, export_lights=False)
bpy.ops.wm.save_as_mainfile(filepath=OUT.replace('.glb','.blend'), compress=True)
print('EXPORTED',OUT,os.path.getsize(OUT))
