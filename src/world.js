import * as THREE from 'three/webgpu';
import { Fn, Loop, attribute, color, mix, positionLocal, positionWorld, smoothstep, time, uniformArray, vec2, vec3 } from 'three/tsl';

export const ISLAND = 7.4;
const GRASS_LIGHT = new THREE.Color('#a9d46f');
const GRASS_DARK = new THREE.Color('#6fae55');
const MEADOW = new THREE.Color('#8cc463');

// a = light square, rank 0 file 0 is dark
export const squareColor = (f, r) => ((f + r) & 1 ? 'light' : 'dark');
export const squarePos = (sq, out = new THREE.Vector3()) => out.set((sq & 7) - 3.5, 0, 3.5 - (sq >> 3));

export const ramp = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 210, 210, 210, 255, 255, 255, 255, 255]), 3, 1);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// rounded-square island outline: radius in direction angle
const outline = (a, size) => size / Math.pow(Math.abs(Math.cos(a)) ** 4 + Math.abs(Math.sin(a)) ** 4, 0.25) * (1 + (noise(Math.cos(a) * 3, Math.sin(a) * 3) - 0.5) * 0.08);
export const onIsland = (x, z, margin = 0) => Math.hypot(x, z) < outline(Math.atan2(z, x), ISLAND) - margin;

function islandMesh() {
  const group = new THREE.Group();
  const segs = 96, rings = [
    // [radius scale, y, color]
    [1.0, 0, '#7fbf5a'],
    [1.0, -0.18, '#6aa64c'],
    [0.98, -0.32, '#9c7350'],
    [0.9, -1.1, '#8a6446'],
    [0.72, -2.0, '#7a5840'],
    [0.45, -3.0, '#6c4e3a'],
    [0.18, -3.9, '#5f4534'],
  ];
  const pos = [], col = [], idx = [];
  const c = new THREE.Color();
  rings.forEach(([s, y, hex], ri) => {
    c.set(hex);
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const wobble = ri > 1 ? (noise(Math.cos(a) * 4 + ri * 7, Math.sin(a) * 4) - 0.5) * 0.9 * s : 0;
      const r = outline(a, ISLAND) * s + wobble;
      pos.push(Math.cos(a) * r, y + (ri > 2 ? (noise(a * 5, ri) - 0.5) * 0.4 : 0), Math.sin(a) * r);
      const shade = 0.88 + noise(a * 9, ri * 3) * 0.24;
      col.push(c.r * shade, c.g * shade, c.b * shade);
    }
  });
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let i = 0; i < segs; i++) {
      const a = ri * segs + i, b = ri * segs + ((i + 1) % segs), d = a + segs, e = b + segs;
      idx.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const side = new THREE.Mesh(geo, new THREE.MeshToonNodeMaterial({ vertexColors: true, gradientMap: ramp }));
  side.receiveShadow = true;
  group.add(side);

  const shape = new THREE.Shape();
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2, r = outline(a, ISLAND);
    i ? shape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const topGeo = new THREE.ShapeGeometry(shape, 1).rotateX(-Math.PI / 2);
  // painted meadow: soft patches of lighter and darker green, a worn ring of path around the board
  const top = new THREE.MeshToonNodeMaterial({ gradientMap: ramp });
  const p = positionWorld.xz;
  const blot = Fn(([q]) => q.x.mul(1.3).sin().mul(q.y.mul(1.1).cos()).add(q.x.add(q.y).mul(0.7).sin().mul(0.6)))(p);
  const edge = p.x.abs().max(p.y.abs());
  const path = smoothstep(4.25, 4.4, edge).mul(smoothstep(4.95, 4.8, edge));
  top.colorNode = mix(mix(color(MEADOW), color('#a3d071'), blot.mul(0.25).add(0.5)), color('#d9c79a'), path.mul(0.85));
  const cap = new THREE.Mesh(topGeo, top);
  cap.receiveShadow = true;
  cap.renderOrder = -1;
  group.add(cap);
  return group;
}

function boardMesh() {
  // the board itself is lawn: two mown greens, each square's stripes running the other way to its neighbours
  const geo = new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2).translate(0, 0.01, 0);
  const mat = new THREE.MeshToonNodeMaterial({ gradientMap: ramp });
  const p = positionWorld.xz.add(4);
  const cell = p.floor();
  const odd = cell.x.add(cell.y).mod(2);
  const local = p.fract();
  const stripe = mix(local.x, local.y, odd).mul(Math.PI * 4).sin().mul(0.5).add(0.5);
  const base = mix(color(GRASS_DARK), color(GRASS_LIGHT), odd);
  const border = smoothstep(0.0, 0.035, local.x.min(local.y).min(local.x.oneMinus()).min(local.y.oneMinus()));
  mat.colorNode = base.mul(stripe.mul(0.08).add(0.96)).mul(border.mul(0.12).add(0.88));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// one merged mesh of grass blades: short on the board (coloured like the square under it), taller in the meadow.
// Blades sway in the wind and lean away from the pieces standing among them.
export const MAX_PUSHERS = 32;
function grassMesh() {
  const pos = [], col = [], root = [], bend = [];
  const c = new THREE.Color(), tip = new THREE.Color();
  const blade = (x, z, h, w, base) => {
    const a = hash(x * 3.1, z * 7.7) * Math.PI;
    const dx = Math.cos(a) * w, dz = Math.sin(a) * w;
    const lean = (hash(z, x) - 0.5) * 0.3;
    tip.copy(base).offsetHSL(0.01, 0.05, 0.12);
    const pts = [[-dx, 0, -dz, 0], [dx, 0, dz, 0], [-dx * 0.55, h * 0.55, -dz * 0.55, 0.55], [dx * 0.55, h * 0.55, dz * 0.55, 0.55], [lean, h, lean, 1]];
    const tris = [[0, 1, 2], [1, 3, 2], [2, 3, 4]];
    for (const tri of tris) {
      for (const i of tri) {
        const [px, py, pz, t] = pts[i];
        pos.push(x + px, py, z + pz);
        c.copy(base).lerp(tip, t).multiplyScalar(0.8 + t * 0.2);
        col.push(c.r, c.g, c.b);
        root.push(x, z);
        bend.push(t);
      }
    }
  };
  const base = new THREE.Color();
  for (let i = 0; i < 11000; i++) {
    const x = (Math.random() - 0.5) * 8, z = (Math.random() - 0.5) * 8;
    const light = squareColor(Math.floor(x + 4), Math.floor(4 - z)) === 'light';
    base.copy(light ? GRASS_LIGHT : GRASS_DARK).offsetHSL((Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.06);
    blade(x, z, 0.035 + Math.random() * 0.035, 0.014, base);
  }
  for (let i = 0; i < 24000; i++) {
    const x = (Math.random() - 0.5) * ISLAND * 2, z = (Math.random() - 0.5) * ISLAND * 2;
    const edge = Math.max(Math.abs(x), Math.abs(z));
    if (edge < 4.15 || (edge > 4.3 && edge < 4.9) || !onIsland(x, z, 0.1)) continue;
    // clumps: taller blades where a slow noise field peaks
    const clump = noise(x * 0.9, z * 0.9);
    base.copy(MEADOW).offsetHSL((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.08 + (clump - 0.5) * 0.1);
    blade(x, z, 0.05 + Math.random() * 0.05 + clump * clump * 0.12, 0.02, base);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('root', new THREE.Float32BufferAttribute(root, 2));
  geo.setAttribute('bend', new THREE.Float32BufferAttribute(bend, 1));

  const pushers = uniformArray(Array.from({ length: MAX_PUSHERS }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4');
  const mat = new THREE.MeshToonNodeMaterial({ vertexColors: true, gradientMap: ramp, side: THREE.DoubleSide });
  mat.positionNode = Fn(() => {
    const r = attribute('root', 'vec2');
    const t = attribute('bend', 'float');
    const k = t.mul(t);
    const gust = r.x.mul(0.35).add(r.y.mul(0.2)).add(time.mul(1.3)).sin().mul(0.5).add(r.x.mul(1.7).sub(time.mul(2.1)).sin().mul(0.25));
    const wind = vec3(gust.mul(0.06), 0, gust.mul(0.035)).mul(k);
    const push = vec2(0).toVar();
    Loop(MAX_PUSHERS, ({ i }) => {
      const pp = pushers.element(i);
      const d = r.sub(pp.xy);
      const dist = d.length().max(0.001);
      const f = smoothstep(pp.z, pp.z.mul(0.3), dist).mul(pp.w);
      push.addAssign(d.div(dist).mul(f));
    });
    const flat = push.length().min(1);
    return positionLocal.add(wind).add(vec3(push.x, 0, push.y).mul(0.12).mul(k)).sub(vec3(0, positionLocal.y.mul(flat).mul(0.55), 0));
  })();
  mat.normalNode = vec3(0, 1, 0);
  // toonOutlinePass outlines toon materials; blades would turn into ink scribbles
  mat.isMeshToonNodeMaterial = mat.isMeshToonMaterial = false;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.userData.pushers = pushers;
  return mesh;
}

function cloudMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshToonNodeMaterial({ color: '#ffffff', gradientMap: ramp, emissive: new THREE.Color('#d6e6f2'), emissiveIntensity: 0.55, fog: false });
  mat.isMeshToonNodeMaterial = mat.isMeshToonMaterial = false;
  const n = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    const s = 0.7 + Math.random() * 0.9;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 2), mat);
    m.position.set((i - n / 2) * 0.9 + Math.random() * 0.4, Math.random() * 0.4 - s * 0.2, (Math.random() - 0.5) * 0.9);
    m.scale.y = 0.75;
    g.add(m);
  }
  return g;
}

function skyDome() {
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  const h = positionLocal.normalize().y;
  mat.colorNode = mix(mix(color('#cbe8f4'), color('#e4f4f8'), smoothstep(-0.6, 0.0, h)), color('#79bde8'), smoothstep(0.0, 0.7, h));
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), mat);
  mesh.renderOrder = -10;
  return mesh;
}

// file letters and rank numbers painted on the path round the board, facing whichever player sits on that side
function labels() {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(0.34, 0.34).rotateX(-Math.PI / 2);
  const tex = (text) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 44px Georgia, "Times New Roman", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(120, 92, 58, 0.85)';
    g.fillText(text, 32, 35);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const sides = { w: new THREE.Group(), b: new THREE.Group() };
  group.add(sides.w, sides.b);
  const put = (text, x, z, yaw, side) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicNodeMaterial({ map: tex(text), transparent: true, depthWrite: false }));
    m.position.set(x, 0.02, z);
    m.rotation.y = yaw;
    m.renderOrder = 1;
    sides[side].add(m);
  };
  // one set reads from the pale blue side, one from the deep teal side; only the one facing the camera shows
  for (let i = 0; i < 8; i++) {
    const file = 'abcdefgh'[i], rank = String(i + 1);
    for (const z of [4.55, -4.55]) put(file, i - 3.5, z, 0, 'w');
    for (const z of [4.55, -4.55]) put(file, i - 3.5, z, Math.PI, 'b');
    for (const x of [4.55, -4.55]) put(rank, x, 3.5 - i, 0, 'w');
    for (const x of [4.55, -4.55]) put(rank, x, 3.5 - i, Math.PI, 'b');
  }
  group.userData.sides = sides;
  return group;
}

export function createWorld(scene) {
  scene.add(skyDome());
  scene.add(islandMesh());
  scene.add(boardMesh());
  const marks = labels();
  scene.add(marks);
  const grass = grassMesh();
  scene.add(grass);

  // clouds keep clear of the space between any camera position and the board: a far ring around the island,
  // and a lower layer drifting underneath it; they circle slowly instead of crossing over
  const clouds = [];
  for (let i = 0; i < 16; i++) {
    const c = cloudMesh();
    const low = i % 2 === 0;
    c.userData = { angle: Math.random() * Math.PI * 2, r: low ? 9 + Math.random() * 10 : 75 + Math.random() * 20, y: low ? -6 - Math.random() * 4 : -10 + Math.random() * 30, speed: (0.008 + Math.random() * 0.01) * (low ? 1.6 : 1) };
    c.scale.setScalar(low ? 1 + Math.random() * 0.8 : 4 + Math.random() * 3);
    clouds.push(c);
    scene.add(c);
  }

  const pushers = grass.userData.pushers.array;
  return {
    // pieces flatten the grass around them: [x, z, radius, strength]
    setPushers(list) {
      for (let i = 0; i < MAX_PUSHERS; i++) {
        const p = list[i];
        if (p) pushers[i].set(p[0], p[1], p[2], p[3]);
        else pushers[i].w = 0;
      }
    },
    update(dt, lightSide = true) {
      for (const c of clouds) {
        const u = c.userData;
        u.angle += u.speed * dt;
        c.position.set(Math.cos(u.angle) * u.r, u.y, Math.sin(u.angle) * u.r);
      }
      marks.userData.sides.w.visible = lightSide;
      marks.userData.sides.b.visible = !lightSide;
    },
  };
}
