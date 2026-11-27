import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ramp } from './world.js';

const TEAMS = ['light', 'dark'];
const box = new THREE.Box3();
const v = new THREE.Vector3();
const FILES = [
  ...TEAMS.flatMap((t) => ['pawn', 'bishop', 'queen', 'king', 'rider', 'horse', 'tower'].map((p) => `${p}_${t}`)),
  'prop_staff', 'prop_scepter', 'prop_sword', 'anims', 'ride',
  'tree', 'mushrooms', 'rock', 'tent_light', 'tent_dark',
];

function toToon(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.geometry.attributes.normal;
    // Meshy smart-topology exports some zero/NaN normals, which render as black triangles
    for (let i = 0; i < n.count; i++) {
      if (!(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) > 0.5)) {
        o.geometry.computeVertexNormals();
        break;
      }
    }
    o.material = new THREE.MeshToonNodeMaterial({ map: o.material.map, gradientMap: ramp });
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
  });
  return root;
}

// scales a model to a height, centred on the origin and standing on y = 0
export function fit(root, height) {
  root.updateMatrixWorld(true);
  box.setFromObject(root, true);
  const s = height / (box.max.y - box.min.y);
  root.scale.multiplyScalar(s);
  root.updateMatrixWorld(true);
  box.setFromObject(root, true);
  const c = box.getCenter(v);
  root.position.x -= c.x;
  root.position.z -= c.z;
  root.position.y -= box.min.y;
  return root;
}

// Resolves with every model and clip once loaded; onProgress(fraction) as the files arrive.
export async function loadAssets(onProgress) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (url, loaded, total) => onProgress(loaded / total);
  const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  const gltfs = await Promise.all(FILES.map((f) => loader.loadAsync(`models/${f}.glb`)));
  const out = {};
  FILES.forEach((f, i) => {
    const g = gltfs[i];
    if (f === 'anims' || f === 'ride') {
      out[f] = { clips: Object.fromEntries(g.animations.map((c) => [c.name, c])), hips: g.scene.getObjectByName('Hips').position.clone() };
    } else {
      out[f] = { scene: toToon(g.scene), clips: Object.fromEntries(g.animations.map((c) => [c.name, c])) };
    }
  });
  return out;
}
