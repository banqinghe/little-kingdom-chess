// ?piece=qw (type + colour) or ?model=tent_dark, &clip=cheer &t=1.5 (seconds in), &bg=#ffffff, &yaw=0.6, &pitch=0.35, &size=768, &bust=1 for head and shoulders
import * as THREE from 'three/webgpu';
import { toonOutlinePass } from 'three/tsl';
import { loadAssets } from '../src/assets.js';
import { Piece } from '../src/piece.js';

// the black and white shots must show the same pose, so idle phases come from a fixed seed
let seed = 1;
Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const q = new URLSearchParams(location.search);
const size = +(q.get('size') ?? 768);
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(size, size);
document.body.appendChild(renderer.domElement);
await renderer.init();
const scene = new THREE.Scene();
scene.background = new THREE.Color(q.get('bg') ?? '#ffffff');
scene.add(new THREE.HemisphereLight('#fff6e0', '#8fb0c8', 1.5));
const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
sun.position.set(-3, 6, 5);
scene.add(sun);
const assets = await loadAssets(() => {});
let obj;
if (q.get('piece')) {
  const [type, color] = q.get('piece');
  const p = new Piece(assets, type, color);
  p.root.rotation.y = 0;
  obj = p.root;
  if (q.get('clip')) p.react(q.get('clip'), { fade: 0 });
  // settle into the idle pose
  for (let i = 0; i < 30 * +(q.get("t") ?? 1); i++) p.update(1 / 30, i / 30);
} else {
  obj = assets[q.get('model')].scene.clone();
}
scene.add(obj);
obj.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(obj, true);
const center = box.getCenter(new THREE.Vector3());
let radius = box.getBoundingSphere(new THREE.Sphere()).radius;
if (q.has('bust')) {
  const h = box.max.y - box.min.y;
  center.y = box.max.y - h * 0.3;
  radius = h * 0.32;
}
const yaw = +(q.get('yaw') ?? 0.55), pitch = +(q.get('pitch') ?? 0.32);
const camera = new THREE.PerspectiveCamera(24, 1, 0.01, 100);
const dist = (radius / Math.sin(THREE.MathUtils.degToRad(12))) * +(q.get('fill') ?? 0.92);
camera.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(center);
camera.lookAt(center);
const pipeline = new THREE.RenderPipeline(renderer);
pipeline.outputNode = toonOutlinePass(scene, camera, new THREE.Color('#2b4552'), 0.0028 * (900 / size), 1);
pipeline.render();
await new Promise((r) => setTimeout(r, 300));
pipeline.render();
document.title = 'ready';
