# Splits a Meshy wheeled piece into a body and wheels whose origins sit on their hubs, so the game can roll them.
# The model is first turned so that it faces -Y (glTF +Z) with its axles along X; each side may carry one wheel or
# a front and a back one. A wheel is every loose part inside its disc.
# usage: Blender -b --python split_wheels.py -- <in.glb> <out.glb> <turn degrees about Z> [preview.png]
import bpy, bmesh, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst, turn = argv[0], argv[1], float(argv[2])
preview = argv[3] if len(argv) > 3 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
body = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
body.parent = None
body.name = 'body'
body.data.transform(Matrix.Rotation(math.radians(turn), 4, 'Z'))

bm = bmesh.new()
bm.from_mesh(body.data)
bm.verts.ensure_lookup_table()
parts, seen = [], set()
for v in bm.verts:
    if v.index in seen:
        continue
    seen.add(v.index)
    stack, comp = [v], []
    while stack:
        x = stack.pop()
        comp.append(x.index)
        for e in x.link_edges:
            y = e.other_vert(x)
            if y.index not in seen:
                seen.add(y.index)
                stack.append(y)
    parts.append(comp)
co = lambda i: bm.verts[i].co


def box(comp):
    ps = [co(i) for i in comp]
    return Vector([min(p[k] for p in ps) for k in range(3)]), Vector([max(p[k] for p in ps) for k in range(3)])


boxes = [box(c) for c in parts]
xmax = max(v.co.x for v in bm.verts)
zmid = (min(v.co.z for v in bm.verts) + max(v.co.z for v in bm.verts)) / 2
wheels = {}
for side, sign in (('L', 1), ('R', -1)):
    # rims (one ring or several arcs): thin-in-X parts at the outer face of this side, low on the piece
    rims = [b for b in boxes if min(b[0].x * sign, b[1].x * sign) > 0.75 * xmax and (b[1].x - b[0].x) < 0.3 * xmax and (b[0].z + b[1].z) / 2 < zmid]
    # a front and a back wheel: the parts lie wholly on one side of the middle; beams that cross it are not wheel
    front = [b for b in rims if b[1].y < 0]
    back = [b for b in rims if b[0].y > 0]
    groups = [front, back] if front and back else [rims]
    for k, g in enumerate(groups):
        lo = Vector([min(b[0][i] for b in g) for i in range(3)])
        hi = Vector([max(b[1][i] for b in g) for i in range(3)])
        # the front-to-back extent is the wheel's diameter; the hub sits one radius above its lowest point
        radius = (hi.y - lo.y) / 2
        if radius < 0.05:
            continue
        hub = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z + radius))
        inner = min(abs(lo.x), abs(hi.x)) - 0.35 * radius
        members = []
        for c, (b0, b1) in zip(parts, boxes):
            if min(b0.x * sign, b1.x * sign) < inner:
                continue
            if all(((co(i).y - hub.y) ** 2 + (co(i).z - hub.z) ** 2) ** 0.5 <= radius * 1.15 for i in c):
                members += c
        name = f'wheel_{side}{k}'
        wheels[name] = (hub, radius, members)
        print(name, 'hub', tuple(round(a, 3) for a in hub), 'r', round(radius, 3), 'verts', len(members))
bm.free()

# tag every wheel before splitting: separating one renumbers the vertices left behind
for name, (hub, radius, members) in wheels.items():
    body.vertex_groups.new(name=name).add(members, 1.0, 'REPLACE')
for name, (hub, radius, members) in wheels.items():
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    body.vertex_groups.active = body.vertex_groups[name]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.vertex_group_select()
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    wheel = next(o for o in bpy.context.selected_objects if o is not body)
    wheel.name = name
    xs = [v.co.x for v in wheel.data.vertices]
    bpy.context.scene.cursor.location = Vector(((min(xs) + max(xs)) / 2, hub.y, hub.z))
    bpy.ops.object.select_all(action='DESELECT')
    wheel.select_set(True)
    bpy.context.view_layer.objects.active = wheel
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    # the game reads the radius to roll the wheel at the speed the piece moves
    wheel['radius'] = radius
for o in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
    o.vertex_groups.clear()

if preview:
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'OBJECT'
    scene.render.resolution_x = scene.render.resolution_y = 400
    scene.world = bpy.data.worlds.new('w')
    body.color = (0.8, 0.8, 0.8, 1)
    colors = [(1, 0.3, 0.3, 1), (0.3, 0.4, 1, 1), (0.3, 0.9, 0.4, 1), (1, 0.8, 0.2, 1)]
    for k, name in enumerate(wheels):
        bpy.data.objects[name].color = colors[k % 4]
        bpy.data.objects[name].rotation_euler.x = 0.6
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 1.3
    cam.location = Vector((2.5, -2, 1.2))
    cam.rotation_euler = (-cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = preview
    bpy.ops.render.render(write_still=True)
    for name in wheels:
        bpy.data.objects[name].rotation_euler.x = 0

root = bpy.data.objects.new('tower', None)
bpy.context.scene.collection.objects.link(root)
for o in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
    o.parent = root
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_yup=True, export_extras=True)
print('exported', dst)
