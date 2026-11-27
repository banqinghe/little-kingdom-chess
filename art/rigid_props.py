# Makes held props (the soldiers' shields and swords) rigid: Meshy's auto-weights spread them over the forearm, upper
# arm and even the thigh they hang beside in the A-pose, so they bend as the character moves. Every loose part whose
# centre lies in a box around a hand, on the outer side of it, is weighted 100% to that hand.
# A rigid shield no longer bends with the upper arm, so in arm swings (running) the arm pokes out through its face;
# a disc's optional <push> moves the shield out along its plane normal, away from the body, by that much clearance.
# The new weights (and pushed positions) are written into a copy of the original GLB; nothing else in it changes.
# usage: Blender -b --python rigid_props.py -- <rigged.glb> <out.glb> <hand>:[disc,]<dx>,<dy>,<dz>,<outer>[,<thick>,<reach>[,<push>]]... [preview.png]
# box half-sizes and the outer offset are fractions of the character's height, e.g. LeftHand:disc,0.16,0.16,0.2,0.03
import bpy, bmesh, sys
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
src, dst = args[0], args[1]
specs = [a for a in args[2:] if ':' in a]
preview = next((a for a in args[2:] if a.endswith('.png')), None)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
world = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
H = max(p.z for p in world) - min(p.z for p in world)
centre_x = sum(p.x for p in world) / len(world)

bm = bmesh.new()
bm.from_mesh(mesh.data)
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
bm.free()

chosen = {}
pushes = {}
body = sum(world, Vector()) / len(world)
for spec in specs:
    hand, nums = spec.split(':')
    disc = nums.startswith('disc,')
    nums = [float(n) for n in nums.removeprefix('disc,').split(',')]
    dx, dy, dz, outer = (n * H for n in nums[:4])
    # shields: how thick the disc may be (fraction of height) and how far past the fitted rim to reach
    thick, reach = (nums[4:6] + [0.025, 1.08][len(nums[4:6]):])
    hp = arm.matrix_world @ arm.data.bones[hand].head_local
    side = 1 if hp.x > centre_x else -1
    picked = []
    for comp in parts:
        c = sum((world[i] for i in comp), Vector()) / len(comp)
        if abs(c.x - hp.x) < dx and abs(c.y - hp.y) < dy and abs(c.z - hp.z) < dz and (c.x - hp.x) * side > -outer:
            picked += comp
    if disc:
        # a shield: the box catches its outer half. Fit the shield's plane to that half, take its height as the
        # diameter and its outer rim as the edge; every part lying wholly inside that thin disc belongs to it too
        ps = np.array([world[i] for i in picked])
        c0 = ps.mean(axis=0)
        n = np.linalg.eigh(np.cov((ps - c0).T))[1][:, 0]
        u = np.array([side, 0.0, 0.0]) - n * n[0] * side
        u /= np.linalg.norm(u)
        v = np.cross(n, u)
        du, dv, dn = (ps - c0) @ u, (ps - c0) @ v, (ps - c0) @ n
        r = (dv.max() - dv.min()) / 2
        centre = c0 + u * (du.max() - r) + v * (dv.max() + dv.min()) / 2
        depth = np.abs(dn).max() + thick * H
        for comp in parts:
            q = np.array([world[i] for i in comp]) - centre
            inplane = q - np.outer(q @ n, n)
            if (np.abs(q @ n) <= depth).all() and (np.linalg.norm(inplane, axis=1) <= r * reach).all():
                picked += comp
        # the disc also catches thin bits of tunic lying against the shield; Meshy weighted those to the hips, legs
        # and spine, the shield itself mostly to this arm, so a part with little weight on the arm is left alone
        side_name = hand.removesuffix('Hand')
        arm_groups = {g.index for g in mesh.vertex_groups if g.name in (hand, side_name + 'ForeArm', side_name + 'Arm')}
        def on_arm(comp):
            return sum(g.weight for i in comp for g in mesh.data.vertices[i].groups if g.group in arm_groups) / len(comp)
        kept = []
        for comp in parts:
            if comp[0] in set(picked):
                if on_arm(comp) >= 0.2:
                    kept += comp
                else:
                    print(hand, 'left out a part of', len(comp), 'verts, arm weight', round(on_arm(comp), 2))
        picked = sorted(set(kept))
        push = nums[6] if len(nums) > 6 else 0
        if push:
            ps = np.array([world[i] for i in picked])
            c1 = ps.mean(axis=0)
            n1 = np.linalg.eigh(np.cov((ps - c1).T))[1][:, 0]
            if np.dot(c1 - np.array(body), n1) < 0:
                n1 = -n1
            pushes[hand] = (picked, mesh.matrix_world.inverted().to_3x3() @ Vector(n1 * push * H))
    chosen[hand] = picked
    print(hand, 'verts', len(picked))

if preview:
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.color_type = 'VERTEX'
    sc.render.resolution_x = sc.render.resolution_y = 400
    sc.world = bpy.data.worlds.new('w')
    col = mesh.data.color_attributes.new('mark', 'BYTE_COLOR', 'POINT')
    marked = {i: k for k, vs in enumerate(chosen.values()) for i in vs}
    for i in range(len(mesh.data.vertices)):
        col.data[i].color = ((1, 0.2, 0.2, 1), (0.2, 0.5, 1, 1))[marked[i]] if i in marked else (0.85, 0.85, 0.85, 1)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = H * 1.3
    mid = Vector((centre_x, sum(p.y for p in world) / len(world), min(p.z for p in world) + H / 2))
    cam.location = mid + Vector((0, -3 * H, 0))
    cam.rotation_euler = Vector((0, 1, 0)).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = preview
    bpy.ops.render.render(write_still=True)
    mesh.data.color_attributes.remove(col)

# Patch the weights straight into the original file: a Blender re-export would change the bones' rest
# orientation, which the shared animation clips depend on. The importer keeps glTF vertex order.
import json, struct
data = open(src, 'rb').read()
jlen = struct.unpack('<I', data[12:16])[0]
gltf = json.loads(data[20:20 + jlen])
blen = struct.unpack('<I', data[20 + jlen:24 + jlen])[0]
binary = bytearray(data[28 + jlen:28 + jlen + blen])
prim = next(p for m in gltf['meshes'] for p in m['primitives'] if 'JOINTS_0' in p['attributes'])
skin = gltf['skins'][0]
SIZE = {5121: 1, 5123: 2, 5126: 4}
FMT = {5121: 'B', 5123: 'H', 5126: 'f'}


def accessor(name):
    acc = gltf['accessors'][prim['attributes'][name]]
    view = gltf['bufferViews'][acc['bufferView']]
    start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = view.get('byteStride', 4 * SIZE[acc['componentType']])
    assert acc['count'] == len(mesh.data.vertices), 'vertex order differs from the file'
    return acc['componentType'], start, stride


jt, jstart, jstride = accessor('JOINTS_0')
wt, wstart, wstride = accessor('WEIGHTS_0')
one = {5126: 1.0, 5121: 255, 5123: 65535}[wt]
for hand, verts in chosen.items():
    joint = next(k for k, n in enumerate(skin['joints']) if gltf['nodes'][n]['name'] == hand)
    for i in verts:
        struct.pack_into('<4' + FMT[jt], binary, jstart + i * jstride, joint, 0, 0, 0)
        struct.pack_into('<4' + FMT[wt], binary, wstart + i * wstride, one, 0, 0, 0)
if pushes:
    acc = gltf['accessors'][prim['attributes']['POSITION']]
    view = gltf['bufferViews'][acc['bufferView']]
    assert acc['componentType'] == 5126 and acc['count'] == len(mesh.data.vertices)
    pstart, pstride = view.get('byteOffset', 0) + acc.get('byteOffset', 0), view.get('byteStride', 12)
    # the importer turns glTF's Y-up into Blender's Z-up (blender (x, y, z) is glTF (x, -z, y)) and may rescale a
    # skinned mesh's data; find that scale from the data and check that it maps every vertex onto the file
    filep = np.array([struct.unpack_from('<3f', binary, pstart + i * pstride) for i in range(acc['count'])])
    co = np.array([v.co[:] for v in mesh.data.vertices])[:, [0, 2, 1]] * [1, 1, -1]
    k = float((filep * co).sum() / (co * co).sum())
    assert np.abs(filep - co * k).max() < 1e-4 * np.abs(filep).max(), 'vertex positions differ from the file'
    for hand, (verts, d) in pushes.items():
        dd = np.array([d[0], d[2], -d[1]]) * k
        for i in verts:
            struct.pack_into('<3f', binary, pstart + i * pstride, *(filep[i] + dd))
    pos = [struct.unpack_from('<3f', binary, pstart + i * pstride) for i in range(acc['count'])]
    acc['min'] = [min(p[k] for p in pos) for k in range(3)]
    acc['max'] = [max(p[k] for p in pos) for k in range(3)]
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    rest = data[20 + jlen:]
    rest = rest[:8] + bytes(binary) + rest[8 + blen:]
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + len(rest)) + struct.pack('<II', len(js), 0x4E4F534A) + js + rest
else:
    out = data[:28 + jlen] + bytes(binary) + data[28 + jlen + blen:]
open(dst, 'wb').write(out)
print('patched', dst)
