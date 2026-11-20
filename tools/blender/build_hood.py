# Happi hood for the selfie: centre the face opening at the origin, scale to face units, decimate, export GLB.
import bpy, sys, mathutils
from mathutils.bvhtree import BVHTree
argv=sys.argv[sys.argv.index('--')+1:]
src,out=argv[0],argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ob=[o for o in bpy.context.scene.objects if o.type=='MESH'][0]
bpy.context.view_layer.objects.active=ob; ob.select_set(True)
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
dg=bpy.context.evaluated_depsgraph_get(); bvh=BVHTree.FromObject(ob,dg)
def depth(x,z):
    h=bvh.ray_cast(mathutils.Vector((x,-5,z)),mathutils.Vector((0,1,0)))
    return h[0].y if h[0] else None
zs=[i/100 for i in range(-90,91)]
hole=[z for z in zs if (d:=depth(0,z)) is not None and d>0.0]
z0,z1=min(hole),max(hole); zc=(z0+z1)/2
xs=[i/100 for i in range(-90,91)]
holex=[x for x in xs if (d:=depth(x,zc)) is not None and d>0.0]
x0,x1=min(holex),max(holex); xc=(x0+x1)/2
# the rim's front: depth just outside the hole
rim=min(depth(xc,z1+0.06) or 0, depth(x1+0.06,zc) or 0)
print('HOLE x',x0,x1,'z',z0,z1,'rimY',rim)
# move the opening centre to the origin (rim plane at y = 0)
for v in ob.data.vertices: v.co-=mathutils.Vector((xc,rim,zc))
w=x1-x0
s=1.5/w  # opening ~1.5 face units wide (~17-20 cm)
for v in ob.data.vertices: v.co*=s
print('SCALE',s,'OPEN W FU',w*s,'H FU',(z1-z0)*s)
dec=ob.modifiers.new('d','DECIMATE'); dec.ratio=min(1.0,12000/len(ob.data.polygons))
bpy.ops.object.modifier_apply(modifier='d')
for m in ob.data.materials:
    nt=m.node_tree; b=nt.nodes.get('Principled BSDF')
    for l in list(nt.links):
        if b and l.to_node==b and l.to_socket.name.startswith('Emission'): nt.links.remove(l)
    if b: b.inputs['Roughness'].default_value=0.85; b.inputs['Metallic'].default_value=0
for im in bpy.data.images:
    if im.size[0]>1024: im.scale(1024,1024)
ob.name='HappiHood'
print('POLYS',len(ob.data.polygons))
bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',use_selection=True,export_image_format='WEBP',export_image_quality=85,export_yup=True,export_animations=False)
import os; print('OUT',os.path.getsize(out))
