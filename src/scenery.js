import * as THREE from 'three/webgpu';
import { fit } from './assets.js';
import { onIsland } from './world.js';

// a fixed little garden around the board: same layout every visit
function rng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

// [model, height, x, z, yaw]; each team's camp sits behind its own back rank
const LAYOUT = [
  ['tent_light', 1.35, -3.3, 6.25, Math.PI + 0.25],
  ['tent_light', 1.1, 3.6, 6.0, Math.PI - 0.3],
  ['tent_dark', 1.35, 3.3, -6.25, 0.25],
  ['tent_dark', 1.1, -3.6, -6.0, -0.3],
  ['tree', 1.9, -6.2, -5.4, 0],
  ['tree', 1.6, 6.3, -4.6, 1],
  ['tree', 1.7, -6.5, 1.2, 2],
  ['tree', 1.4, 6.4, 2.4, 3],
  ['tree', 1.3, -5.9, 5.6, 4],
  ['tree', 1.5, 6.0, 5.9, 5],
];
const SCATTER = { mushrooms: [11, 0.3], rock: [9, 0.34] };

function flowers() {
  // tiny daisies and forget-me-nots as one merged mesh
  const pos = [], col = [];
  const r = rng(7);
  const c = new THREE.Color();
  const kinds = [['#ffffff', '#ffd34d'], ['#9fcfff', '#fff3a0'], ['#ffd1e0', '#ffe28a']];
  let placed = 0;
  while (placed < 420) {
    const x = (r() - 0.5) * 14.6, z = (r() - 0.5) * 14.6;
    const edge = Math.max(Math.abs(x), Math.abs(z));
    if (edge < 5 || !onIsland(x, z, 0.3)) continue;
    placed++;
    const [petal, heart] = kinds[r() < 0.6 ? 0 : r() < 0.6 ? 1 : 2];
    const y = 0.12 + r() * 0.1, s = 0.035 + r() * 0.025, a0 = r() * Math.PI;
    const tri = (ax, az, bx, bz, cx, cz, hex, lift = 0) => {
      pos.push(x + ax, y + lift, z + az, x + bx, y + lift, z + bz, x + cx, y + lift, z + cz);
      c.set(hex);
      for (let i = 0; i < 3; i++) col.push(c.r, c.g, c.b);
    };
    for (let i = 0; i < 5; i++) {
      const a = a0 + (i / 5) * Math.PI * 2, b = a + 0.5, m = a + 0.25;
      tri(0, 0, Math.cos(a) * s, Math.sin(a) * s, Math.cos(b) * s, Math.sin(b) * s, petal);
      tri(Math.cos(a) * s, Math.sin(a) * s, Math.cos(m) * s * 1.5, Math.sin(m) * s * 1.5, Math.cos(b) * s, Math.sin(b) * s, petal);
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2, b = a + (Math.PI * 2) / 5;
      tri(0, 0, Math.cos(a) * s * 0.4, Math.sin(a) * s * 0.4, Math.cos(b) * s * 0.4, Math.sin(b) * s * 0.4, heart, 0.003);
    }
    // stem
    c.set('#5e9a48');
    pos.push(x - 0.004, 0, z, x + 0.004, 0, z, x, y, z);
    for (let i = 0; i < 3; i++) col.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicNodeMaterial({ vertexColors: true, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

export function addScenery(scene, assets) {
  const group = new THREE.Group();
  const place = (name, height, x, z, yaw) => {
    const m = fit(assets[name].scene.clone(), height);
    const holder = new THREE.Group().add(m);
    holder.position.set(x, 0, z);
    holder.rotation.y = yaw;
    group.add(holder);
    return holder;
  };
  for (const [name, h, x, z, yaw] of LAYOUT) place(name, h, x, z, yaw);
  const r = rng(42);
  const taken = LAYOUT.map(([, h, x, z]) => [x, z, h * 0.45]);
  for (const [name, [count, size]] of Object.entries(SCATTER)) {
    for (let n = 0, tries = 0; n < count && tries < 400; tries++) {
      const x = (r() - 0.5) * 14.4, z = (r() - 0.5) * 14.4;
      const edge = Math.max(Math.abs(x), Math.abs(z));
      if (edge < 5.15 || !onIsland(x, z, 0.45)) continue;
      if (taken.some(([tx, tz, tr]) => Math.hypot(x - tx, z - tz) < tr + size)) continue;
      const h = size * (0.75 + r() * 0.5);
      place(name, h, x, z, r() * Math.PI * 2);
      taken.push([x, z, h]);
      n++;
    }
  }
  group.add(flowers());
  scene.add(group);
  return group;
}
