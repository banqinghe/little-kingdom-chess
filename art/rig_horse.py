# Rigs a Meshy pony (single mesh, head toward -Y in Blender, as image-to-3d exports it) with a quadruped skeleton,
# weights it by region and distance to the bones, keys its clips and exports a GLB.
# usage: Blender -b --python rig_horse.py -- <in.glb> <out.glb> [preview_dir]
import bpy, sys, math
from mathutils import Vector, Quaternion, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
preview = argv[2] if len(argv) > 2 else None
FPS = 30

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mesh.parent = None
verts = [v.co.copy() for v in mesh.data.vertices]
xmin, xmax = min(v.x for v in verts), max(v.x for v in verts)
ymin, ymax = min(v.y for v in verts), max(v.y for v in verts)
zmin, zmax = min(v.z for v in verts), max(v.z for v in verts)
Y = lambda t: ymin + t * (ymax - ymin)
Z = lambda t: zmin + t * (zmax - zmin)
yn = lambda v: (v.y - ymin) / (ymax - ymin)
zn = lambda v: (v.z - zmin) / (zmax - zmin)

# legs: centroids of the low vertices per quadrant, leaving out the tail that hangs behind the hind legs
legs = {}
for name, front, sx in [('FL', True, 1), ('FR', True, -1), ('BL', False, 1), ('BR', False, -1)]:
    q = [v for v in verts if zn(v) < 0.25 and yn(v) < 0.85 and (yn(v) < 0.5) == front and v.x * sx > 0]
    c = sum(q, Vector()) / len(q)
    legs[name] = Vector((c.x, c.y, 0))
    print('leg', name, tuple(round(a, 3) for a in c), len(q))
LEG_TOP, KNEE, FETLOCK = 0.31, 0.17, 0.05
SCALE = (zmax - zmin) / 0.8
Z_BODY = Z(0.55)
SADDLE = Vector((0, Y(0.53), Z(0.7)))
MID_Y = Y(0.53)

arm_data = bpy.data.armatures.new('rig')
arm = bpy.data.objects.new('horse', arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones


def bone(name, head, tail, parent=None):
    b = eb.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    b.roll = 0
    if parent:
        b.parent = eb[parent]
    return b


bone('root', (0, MID_Y, zmin), (0, MID_Y, zmin + 0.1))
bone('hips', (0, MID_Y, Z_BODY), (0, Y(0.82), Z_BODY), 'root')
bone('chest', (0, MID_Y, Z_BODY), (0, Y(0.26), Z(0.6)), 'hips')
bone('neck', (0, Y(0.26), Z(0.6)), (0, Y(0.17), Z(0.8)), 'chest')
bone('head', (0, Y(0.17), Z(0.8)), (0, Y(0.0), Z(0.88)), 'neck')
bone('tail1', (0, Y(0.88), Z(0.62)), (0, Y(0.93), Z(0.45)), 'hips')
bone('tail2', (0, Y(0.93), Z(0.45)), (0, Y(0.97), Z(0.27)), 'tail1')
bone('tail3', (0, Y(0.97), Z(0.27)), (0, Y(0.98), Z(0.1)), 'tail2')
bone('saddle', SADDLE, SADDLE + Vector((0, 0, 0.08)), 'hips')
for name, p in legs.items():
    parent = 'chest' if name[0] == 'F' else 'hips'
    bone(f'{name}_upper', (p.x, p.y, Z(LEG_TOP)), (p.x, p.y, Z(KNEE)), parent)
    bone(f'{name}_lower', (p.x, p.y, Z(KNEE)), (p.x, p.y, Z(FETLOCK)), f'{name}_upper')
    bone(f'{name}_hoof', (p.x, p.y, Z(FETLOCK)), (p.x, p.y - 0.02, zmin), f'{name}_lower')
bpy.ops.object.mode_set(mode='OBJECT')
DEFORM = [b.name for b in arm_data.bones if b.name not in ('root', 'saddle')]
arm_data.bones['root'].use_deform = arm_data.bones['saddle'].use_deform = False
segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm_data.bones}


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def region(v):
    x, y, z = v.x, yn(v), zn(v)
    if z < LEG_TOP + 0.02 and y < 0.86:
        front = y < 0.5
        side = 'L' if x > 0 else 'R'
        name = ('F' if front else 'B') + side
        # legs are near-vertical cylinders; the saddle cloth and girth hanging beside them stay on the body
        if math.hypot(v.x - legs[name].x, v.y - legs[name].y) < 0.07 * SCALE:
            return [f'{name}_upper', f'{name}_lower', f'{name}_hoof']
    if y > 0.85 and z < 0.68:
        return ['tail1', 'tail2', 'tail3']
    if y < 0.3 and z > 0.5:
        return ['neck', 'head', 'chest']
    return ['hips', 'chest']


SIGMA = 0.045 * SCALE
groups = {n: mesh.vertex_groups.new(name=n) for n in DEFORM}
for i, v in enumerate(verts):
    names = region(v)
    ws = [math.exp(-(seg_dist(v, *segs[n]) / SIGMA) ** 2) + 1e-9 for n in names]
    s = sum(ws)
    for n, w in zip(names, ws):
        if w / s > 0.01:
            groups[n].add([i], w / s, 'REPLACE')
mod = mesh.modifiers.new('arm', 'ARMATURE')
mod.object = arm
mesh.parent = arm

# ---- clips ----
pb = arm.pose.bones
for p in pb:
    p.rotation_mode = 'QUATERNION'
rest = {b.name: b.matrix_local.to_3x3() for b in arm_data.bones}
X, Yax, Zax = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def rot(name, axis, deg):
    # rotation about a world axis expressed in the bone's rest frame
    local = rest[name].inverted() @ axis
    return Quaternion(local, math.radians(deg))


def pose(frame, spec, root_loc=Vector()):
    for p in pb:
        p.rotation_quaternion = Quaternion()
        p.location = Vector()
    for name, parts in spec.items():
        q = Quaternion()
        for axis, deg in parts:
            q = rot(name, axis, deg) @ q
        pb[name].rotation_quaternion = q
    pb['root'].location = rest['root'].inverted() @ root_loc
    for p in pb:
        p.keyframe_insert('rotation_quaternion', frame=frame)
        p.keyframe_insert('location', frame=frame)


def clip(name, frames, fn, loop=True):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    n = frames if loop else frames + 1
    for f in range(n + (1 if loop else 0)):
        t = f / frames
        spec, loc = fn(t)
        pose(f, spec, loc)
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 0, act)
    # Blender 4.4+ slotted actions: a strip evaluates nothing until it names the slot the keys were written to
    if hasattr(strip, 'action_slot') and act.slots:
        strip.action_slot = act.slots[0]
    arm.animation_data.action = None


S = lambda t: math.sin(2 * math.pi * t)
C = lambda t: math.cos(2 * math.pi * t)
smooth = lambda a, b, t: 0 if t <= a else 1 if t >= b else (lambda u: u * u * (3 - 2 * u))((t - a) / (b - a))
H = zmax - zmin


def tail_swish(t, amp=12, lift=0):
    return {
        'tail1': [(Yax, amp * S(t)), (X, -lift)],
        'tail2': [(Yax, amp * 1.3 * S(t - 0.08)), (X, -lift * 0.6)],
        'tail3': [(Yax, amp * 1.6 * S(t - 0.16)), (X, -lift * 0.4)],
    }


def legs_cycle(t, phases, amp, bend):
    spec = {}
    for name, ph in phases.items():
        u = t + ph
        spec[f'{name}_upper'] = [(X, -amp * S(u))]
        spec[f'{name}_lower'] = [(X, bend * max(0, C(u)))]
        spec[f'{name}_hoof'] = [(X, bend * 0.4 * max(0, C(u)))]
    return spec


def idle(t):
    spec = {'chest': [(X, 1.2 * S(t))], 'neck': [(X, 3 * S(t * 2 + 0.2))], 'head': [(X, -2 * S(t * 2))], **tail_swish(t * 2, 14)}
    return spec, Vector((0, 0, 0.004 * H * S(t)))


def trot(t):
    spec = legs_cycle(t, {'FL': 0, 'BR': 0, 'FR': 0.5, 'BL': 0.5}, 24, 55)
    spec.update({'neck': [(X, 4 * C(2 * t))], 'head': [(X, -2 * C(2 * t))], **tail_swish(t, 8, 10)})
    return spec, Vector((0, 0, 0.018 * H * abs(S(t))))


def gallop(t):
    spec = legs_cycle(t, {'BL': 0, 'BR': 0.07, 'FL': 0.45, 'FR': 0.53}, 38, 75)
    spec.update({'neck': [(X, 7 * C(t))], 'head': [(X, -4 * C(t))], **tail_swish(t, 6, 40)})
    spec['root'] = [(X, 7 * S(t))]
    return spec, Vector((0, 0, 0.05 * H * max(0, S(t + 0.15))))


BACK = Vector((0, (legs['BL'].y + legs['BR'].y) / 2, zmin))
REST_ROOT = Vector((0, MID_Y, zmin))


def about(pivot, axis, deg):
    # root offset that keeps `pivot` fixed while the root turns about `axis`
    q = Quaternion(axis, math.radians(deg))
    return (pivot - REST_ROOT) - q @ (pivot - REST_ROOT)


def rear(t):
    up = smooth(0.0, 0.35, t) - smooth(0.62, 0.75, t)
    slam = smooth(0.62, 0.75, t) - smooth(0.8, 1.0, t)
    pitch = -42 * up + 6 * slam
    kick = smooth(0.1, 0.3, t) * (1 - smooth(0.6, 0.72, t))
    spec = {
        'root': [(X, pitch)],
        'FL_upper': [(X, -60 * kick + 30 * kick * S(t * 4)) if kick else (X, -25 * slam)],
        'FR_upper': [(X, -60 * kick + 30 * kick * S(t * 4 + 0.5)) if kick else (X, -25 * slam)],
        'FL_lower': [(X, 70 * kick * (0.6 + 0.4 * C(t * 4)))],
        'FR_lower': [(X, 70 * kick * (0.6 + 0.4 * C(t * 4 + 0.5)))],
        'BL_upper': [(X, 18 * up)], 'BR_upper': [(X, 18 * up)],
        'BL_lower': [(X, 25 * up)], 'BR_lower': [(X, 25 * up)],
        'neck': [(X, -18 * up + 20 * slam)], 'head': [(X, -12 * up)],
        **tail_swish(t * 3, 15, 25 * up),
    }
    return spec, about(BACK, X, pitch)


def jump(t):
    crouch = smooth(0, 0.15, t) - smooth(0.15, 0.3, t) + 0.6 * (smooth(0.8, 0.9, t) - smooth(0.9, 1.0, t))
    air = smooth(0.15, 0.3, t) - smooth(0.7, 0.85, t)
    pitch = -14 * smooth(0.15, 0.35, t) + 24 * smooth(0.4, 0.75, t) - 10 * smooth(0.75, 0.95, t)
    pitch *= 1 if 0.15 < t < 0.95 else 0
    spec = {
        'root': [(X, pitch)],
        'FL_upper': [(X, -45 * air)], 'FR_upper': [(X, -50 * air)],
        'FL_lower': [(X, 110 * air)], 'FR_lower': [(X, 105 * air)],
        'BL_upper': [(X, 40 * air - 20 * crouch)], 'BR_upper': [(X, 45 * air - 20 * crouch)],
        'BL_lower': [(X, 30 * crouch)], 'BR_lower': [(X, 30 * crouch)],
        'neck': [(X, 12 * air)], **tail_swish(t, 4, 45 * air),
    }
    return spec, Vector((0, 0, -0.05 * H * crouch))


def die(t):
    back = smooth(0, 0.2, t) * (1 - smooth(0.25, 0.4, t))
    fall = smooth(0.25, 0.62, t)
    bounce = 4 * math.sin(math.pi * smooth(0.62, 0.8, t)) * (1 - smooth(0.8, 1, t))
    roll = 88 * fall - bounce
    side = Vector((xmin * 0.8, MID_Y, zmin))
    loc = about(side, Yax, -roll) + Vector((0, 0.06 * H * back, 0))
    limp = fall
    spec = {
        'root': [(X, -12 * back), (Yax, -roll)],
        'neck': [(X, 35 * limp), (Zax, 10 * limp)], 'head': [(X, 15 * limp)],
        'FL_upper': [(X, -20 * limp)], 'FR_upper': [(X, 15 * limp)],
        'BL_upper': [(X, 25 * limp)], 'BR_upper': [(X, -10 * limp)],
        'FL_lower': [(X, 40 * limp)], 'FR_lower': [(X, 20 * limp)], 'BL_lower': [(X, 30 * limp)], 'BR_lower': [(X, 10 * limp)],
        'tail1': [(X, 20 * limp)],
    }
    return spec, loc


clip('idle', 60, idle)
clip('trot', 24, trot)
clip('gallop', 18, gallop)
clip('rear', 48, rear, loop=False)
clip('jump', 24, jump, loop=False)
clip('die', 45, die, loop=False)
bpy.context.scene.render.fps = FPS

if preview:
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x = scene.render.resolution_y = 256
    scene.world = bpy.data.worlds.new('w')
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 1.6 * H
    center = Vector((0, MID_Y, zmin + H * 0.5))
    cam.location = center + Vector((2, -0.6, 0.3)).normalized() * 3
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    ad = arm.animation_data
    ad.use_nla = False
    for act in [t.strips[0].action for t in ad.nla_tracks]:
        ad.action = act
        if hasattr(ad, 'action_slot') and act.slots:
            ad.action_slot = act.slots[0]
        n = int(act.frame_range[1])
        for k, f in enumerate([round(n * i / 5) for i in range(6)]):
            scene.frame_set(f)
            scene.render.filepath = f'{preview}/{act.name}_{k}.png'
            bpy.ops.render.render(write_still=True)
    ad.action = None
    ad.use_nla = True

bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
mesh.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_animations=True,
                          export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_yup=True)
print('exported', dst)
