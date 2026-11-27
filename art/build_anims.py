# Merges the clips of Meshy animation GLBs (all retargeted to the same rig) into one skeleton-only GLB.
# Both players share it: three.js binds tracks to bones by name. Hips keep only their vertical motion,
# since the game moves the players itself.
# usage: python3 build_anims.py <out.glb> <clip>=<file.glb>[:<source clip index>] ...
import json
import struct
import sys


def read(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    off = 20 + jl
    bl = struct.unpack('<I', b[off:off + 4])[0]
    return json.loads(b[20:off]), b[off + 8:off + 8 + bl]


def floats(gltf, binary, i):
    acc = gltf['accessors'][i]
    view = gltf['bufferViews'][acc['bufferView']]
    assert acc['componentType'] == 5126 and 'byteStride' not in view, 'expected tightly packed float accessors'
    n = acc['count'] * {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[acc['type']]
    start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    return list(struct.unpack(f'<{n}f', binary[start:start + 4 * n])), acc['type']


out_path, specs = sys.argv[1], sys.argv[2:]
first, _ = read(specs[0].split('=', 1)[1].split(':')[0])
skin = first['skins'][0]
keep = set(skin['joints'])
# the armature root (parent of the top joint) carries the unit scale
parents = {c: p for p, n in enumerate(first['nodes']) for c in n.get('children', [])}
root = parents.get(skin['joints'][0], skin['joints'][0])
while root in parents and parents[root] not in keep:
    keep.add(root)
    root = parents[root]
keep.add(root)
order = sorted(keep)
index = {old: new for new, old in enumerate(order)}
nodes = []
for old in order:
    n = {k: v for k, v in first['nodes'][old].items() if k in ('name', 'translation', 'rotation', 'scale')}
    kids = [index[c] for c in first['nodes'][old].get('children', []) if c in index]
    if kids:
        n['children'] = kids
    nodes.append(n)
by_name = {n['name']: i for i, n in enumerate(nodes)}
top = [i for i, old in enumerate(order) if old not in parents or parents[old] not in keep]

blob, views, accessors, animations = bytearray(), [], [], []


def put(values, kind, minmax=False):
    while len(blob) % 4:
        blob.append(0)
    views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': 4 * len(values)})
    blob.extend(struct.pack(f'<{len(values)}f', *values))
    acc = {'bufferView': len(views) - 1, 'componentType': 5126, 'count': len(values) // {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[kind], 'type': kind}
    if minmax:
        acc['min'], acc['max'] = [min(values)], [max(values)]
    accessors.append(acc)
    return len(accessors) - 1


for spec in specs:
    name, src = spec.split('=', 1)
    path, _, clip = src.partition(':')
    gltf, binary = read(path)
    anim = gltf['animations'][int(clip or 0)]
    samplers, channels = [], []
    for ch in anim['channels']:
        bone = gltf['nodes'][ch['target']['node']]['name']
        if bone not in by_name:
            continue
        s = anim['samplers'][ch['sampler']]
        times, _ = floats(gltf, binary, s['input'])
        values, kind = floats(gltf, binary, s['output'])
        if bone == 'Hips' and ch['target']['path'] == 'translation':
            rest = nodes[by_name['Hips']].get('translation', [0, 0, 0])
            for k in range(0, len(values), 3):
                values[k], values[k + 2] = rest[0], rest[2]
        samplers.append({'input': put(times, 'SCALAR', True), 'output': put(values, kind), 'interpolation': s.get('interpolation', 'LINEAR')})
        channels.append({'sampler': len(samplers) - 1, 'target': {'node': by_name[bone], 'path': ch['target']['path']}})
    animations.append({'name': name, 'samplers': samplers, 'channels': channels})

doc = {
    'asset': {'version': '2.0', 'generator': 'little-kingdom-chess build_anims.py'},
    'scene': 0,
    'scenes': [{'nodes': top}],
    'nodes': nodes,
    'animations': animations,
    'accessors': accessors,
    'bufferViews': views,
    'buffers': [{'byteLength': len(blob)}],
}
j = json.dumps(doc, separators=(',', ':')).encode()
j += b' ' * (-len(j) % 4)
blob += b'\0' * (-len(blob) % 4)
with open(out_path, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(j) + 8 + len(blob)))
    f.write(struct.pack('<II', len(j), 0x4E4F534A) + j)
    f.write(struct.pack('<II', len(blob), 0x004E4942) + bytes(blob))
print(f'{out_path}: {len(nodes)} bones, clips {[a["name"] for a in animations]}')
