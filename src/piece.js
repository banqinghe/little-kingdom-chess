import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { fit } from './assets.js';

export const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
// standing height in board squares
const HEIGHT = { pawn: 0.74, bishop: 0.94, queen: 0.98, king: 1.04, rider: 0.6, horse: 0.74, tower: 1.0 };
// the prop each character holds; side is the hand on the image the model came from (+1 = its left, at +X)
const PROPS = {
  bishop: { file: 'prop_staff', length: 0.88, grip: 0.42, side: 1 },
  queen: { file: 'prop_scepter', length: 0.42, grip: 0.3, side: 1 },
  king: { file: 'prop_scepter', length: 0.46, grip: 0.3, side: -1 },
  rider_light: { file: 'prop_sword', length: 0.38, grip: 0.12, side: -1 },
};
// each character's own way of standing about, and the little gesture it makes now and then
const IDLE = {
  pawn: { loop: 'idle', fidget: 'idle2' },
  bishop: { loop: 'idle_still', fidget: 'look' },
  queen: { loop: 'idle_queen', fidget: 'primp' },
  king: { loop: 'idle_calm', fidget: 'proud' },
};
// which library clip each piece uses for its strike, and when in that clip the blow lands (fraction)
const STRIKE = {
  pawn: { clip: 'slash', hit: 0.42, speed: 1.25 },
  bishop: { clip: 'spell', hit: 0.5, speed: 1.2 },
  queen: { clip: 'charge', hit: 0.55, speed: 1.15 },
  king: { clip: 'hammer', hit: 0.5, speed: 1.2 },
};

const box = new THREE.Box3();
const v = new THREE.Vector3();
const w = new THREE.Vector3();

// clips come from one rig; other rigs stand at other hip heights, so their hip track is shifted and scaled
const retargeted = new Map();
function clipsFor(key, library, hips) {
  if (retargeted.has(key)) return retargeted.get(key);
  const k = hips.y / library.hips.y;
  const out = {};
  for (const [name, clip] of Object.entries(library.clips)) {
    const c = clip.clone();
    for (const t of c.tracks) {
      if (t.name !== 'Hips.position') continue;
      const a = t.values;
      for (let i = 0; i < a.length; i += 3) {
        a[i] = hips.x + (a[i] - library.hips.x) * k;
        a[i + 1] = hips.y + (a[i + 1] - library.hips.y) * k;
        a[i + 2] = hips.z + (a[i + 2] - library.hips.z) * k;
      }
    }
    out[name] = c;
  }
  retargeted.set(key, out);
  return out;
}

class Rig {
  constructor(model, clips) {
    this.model = model;
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = clips;
    this.actions = {};
    this.base = null;
    this.current = null;
  }
  action(name) {
    return (this.actions[name] ??= this.mixer.clipAction(this.clips[name]));
  }
  loop(name, { fade = 0.25, speed = 1, phase = 0 } = {}) {
    const a = this.action(name);
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = false;
    a.timeScale = speed;
    if (this.current !== a) {
      a.reset();
      a.time = phase * a.getClip().duration;
      a.play();
      if (this.current) this.current.crossFadeTo(a, fade, false);
    }
    this.base = this.current = a;
  }
  once(name, { fade = 0.15, speed = 1, hold = false } = {}) {
    const a = this.action(name);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = speed;
    a.play();
    if (this.current && this.current !== a) this.current.crossFadeTo(a, fade, false);
    this.current = a;
    const dur = a.getClip().duration / speed;
    if (!hold) {
      const base = this.base;
      const done = (e) => {
        if (e.action !== a) return;
        this.mixer.removeEventListener('finished', done);
        if (this.current === a && base) {
          base.reset().play();
          a.crossFadeTo(base, 0.25, false);
          this.current = base;
        }
      };
      this.mixer.addEventListener('finished', done);
    }
    return dur;
  }
  update(dt) {
    this.mixer.update(dt);
  }
}

function humanoid(assets, file, library, height, propSpec, idle = 'idle') {
  const src = assets[file].scene;
  const model = fit(cloneSkinned(src), height);
  const hips = src.getObjectByName('Hips').position;
  const rig = new Rig(model, clipsFor(file, library, hips));
  if (propSpec) {
    // the prop is placed upright in the hand in the idle pose, so it hangs right when the character stands still
    // clips open in the bind pose, so the hand is read mid-clip
    rig.loop(idle, { fade: 0, phase: 0.5 });
    rig.update(0);
    model.updateMatrixWorld(true);
    const hand = ['LeftHand', 'RightHand'].map((n) => model.getObjectByName(n)).reduce((a, b) => (b.getWorldPosition(v).x * propSpec.side > a.getWorldPosition(w).x * propSpec.side ? b : a));
    const prop = fit(assets[propSpec.file].scene.clone(), propSpec.length * height);
    const holder = new THREE.Group().add(prop);
    const at = hand.getWorldPosition(new THREE.Vector3());
    holder.position.set(at.x, at.y - propSpec.grip * propSpec.length * height, at.z + 0.012);
    model.add(holder);
    holder.updateMatrixWorld(true);
    hand.attach(holder);
    rig.prop = holder;
  }
  return rig;
}

export class Piece {
  constructor(assets, type, color) {
    this.type = type;
    this.color = color;
    this.name = NAMES[type];
    const team = color === 'w' ? 'light' : 'dark';
    this.root = new THREE.Group();
    // body takes procedural tilts and hops on top of the clips
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.rigs = [];
    this.moving = false;
    this.travel = 0;
    this.lean = 0;
    this.hop = 0;

    if (type === 'n') {
      const horseSrc = assets[`horse_${team}`];
      const horse = fit(cloneSkinned(horseSrc.scene), HEIGHT.horse);
      this.horse = new Rig(horse, horseSrc.clips);
      this.rider = humanoid(assets, `rider_${team}`, assets.ride, HEIGHT.rider, PROPS[`rider_${team}`], 'ride_idle');
      this.body.add(horse);
      this.rigs.push(this.horse, this.rider);
      this.horse.loop('idle', { phase: Math.random() });
      this.rider.loop('ride_idle', { phase: Math.random() });
      this.rider.update(0);
      horse.updateMatrixWorld(true);
      // seat the rider: hips on the saddle bone, which carries the rider through every horse clip
      const saddle = horse.getObjectByName('saddle');
      const seat = saddle.getWorldPosition(new THREE.Vector3());
      const hips = this.rider.model.getObjectByName('Hips').getWorldPosition(new THREE.Vector3());
      this.rider.model.position.add(seat.sub(hips)).add(new THREE.Vector3(0, 0.02, 0));
      this.body.add(this.rider.model);
      this.rider.model.updateMatrixWorld(true);
      saddle.attach(this.rider.model);
    } else if (type === 'r') {
      const tower = fit(assets[`tower_${team}`].scene.clone(), HEIGHT.tower);
      this.body.add(tower);
      tower.updateMatrixWorld(true);
      this.wheels = [];
      tower.traverse((o) => {
        if (!/^wheel/.test(o.name)) return;
        box.setFromObject(o, true);
        this.wheels.push({ node: o, radius: (box.max.y - box.min.y) / 2 });
      });
      this.tower = tower;
    } else {
      this.idle = IDLE[this.name];
      this.rig = humanoid(assets, `${this.name}_${team}`, assets.anims, HEIGHT[this.name], PROPS[this.name], this.idle.loop);
      this.body.add(this.rig.model);
      this.rigs.push(this.rig);
      this.rig.loop(this.idle.loop, { phase: Math.random(), speed: 0.9 + Math.random() * 0.2 });
    }
    // light faces the dark side (-z) and dark faces +z
    this.homeYaw = color === 'w' ? Math.PI : 0;
    this.root.rotation.y = this.homeYaw;
    this.pushRadius = type === 'p' ? 0.3 : 0.4;
  }

  // back to standing idle on its square: pieces are reused after undo and new games instead of rebuilt
  restore() {
    this.root.scale.setScalar(1);
    this.root.position.y = 0;
    this.root.rotation.set(0, this.homeYaw, 0);
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.lean = this.hop = 0;
    this.toppling = undefined;
    this.moving = false;
    for (const r of this.rigs) {
      r.mixer.stopAllAction();
      r.current = r.base = null;
    }
    if (this.type === 'n') {
      this.horse.loop('idle', { fade: 0, phase: Math.random() });
      this.rider.loop('ride_idle', { fade: 0, phase: Math.random() });
    } else if (this.rig) this.rig.loop(this.idle.loop, { fade: 0, phase: Math.random() });
  }

  // a small gesture, only while standing about
  fidget() {
    if (!this.rig || this.moving || this.rig.current !== this.rig.base || this.rig.base !== this.rig.actions[this.idle.loop]) return;
    this.rig.once(this.idle.fidget, { fade: 0.35 });
  }

  // walk / run / gallop / roll while the stage moves the root
  setMoving(on, kind = 'walk') {
    this.moving = on;
    if (this.type === 'n') {
      this.horse.loop(on ? 'gallop' : 'idle', { fade: 0.2, speed: on ? 1.1 : 1 });
      this.rider.loop(on ? 'ride_gallop' : 'ride_idle', { fade: 0.2, speed: on ? 1.65 : 1 });
    } else if (this.rig) {
      if (!on) this.rig.loop(this.idle.loop, { fade: 0.25 });
      else if (kind === 'run') this.rig.loop('run', { fade: 0.2, speed: 1.15 });
      else this.rig.loop('walk', { fade: 0.2, speed: 1.5 });
    }
  }

  // plays the strike; returns { hit, end } in seconds from now
  strike() {
    if (this.type === 'n') {
      const end = this.horse.once('rear', { speed: 1.1 });
      this.rider.once('ride_slash', { speed: 1.4 });
      return { hit: 1.2 / 1.1, end };
    }
    if (this.type === 'r') return { hit: 0, end: 0 };
    const s = STRIKE[this.name];
    const end = this.rig.once(s.clip, { speed: s.speed });
    return { hit: end * s.hit, end };
  }

  // falls over; style is 'fly' when thrown by a charge, else a plain fall. Returns seconds until it lies still.
  fall(style) {
    if (this.type === 'n') {
      this.rider.once('ride_idle', { fade: 0.1 });
      return this.horse.once('die', { hold: true });
    }
    if (this.type === 'r') {
      this.toppling = 0;
      return 1.1;
    }
    const clip = style === 'fly' ? 'flyup' : Math.random() < 0.5 ? 'knockdown' : 'dieback';
    const d = this.rig.once(clip, { hold: true, speed: clip === 'flyup' ? 1.1 : 1.3 });
    return Math.min(d, 2.2);
  }

  react(name, opts) {
    if (this.rig) return this.rig.once(name, opts);
    if (this.type === 'n') {
      if (name === 'cheer' || name === 'alert') return this.horse.once('rear', { speed: 1.2 });
      if (name === 'kneel') return this.horse.once('die', { hold: true });
    }
    if (this.type === 'r') this.hop = 1;
    return 0.6;
  }

  update(dt, time) {
    for (const r of this.rigs) r.update(dt);
    if (this.type === 'r') this.updateTower(dt, time);
    // a little bounce for hops (reactions, landings)
    if (this.hop > 0) {
      this.hop = Math.max(0, this.hop - dt * 2.2);
      this.body.position.y = Math.sin((1 - this.hop) * Math.PI) * 0.12;
    }
  }

  updateTower(dt, time) {
    const k = 1 - Math.exp(-dt * 8);
    this.body.rotation.x += (this.lean - this.body.rotation.x) * k;
    if (this.moving) this.body.position.y = Math.abs(Math.sin(time * 18)) * 0.012;
    else if (!this.hop) this.body.position.y *= 1 - k;
    if (this.toppling !== undefined) {
      this.toppling = Math.min(1, this.toppling + dt * 1.3);
      const t = this.toppling;
      const fall = t < 0.7 ? (t / 0.7) ** 2 : 1 - Math.sin(((t - 0.7) / 0.3) * Math.PI) * 0.08;
      this.body.rotation.z = fall * 1.45;
      this.body.position.x = -fall * 0.28;
    }
  }

  // rolls the wheels by the distance the root travelled
  roll(dist) {
    if (!this.wheels) return;
    for (const w of this.wheels) w.node.rotation.x += dist / (w.radius || 0.1);
  }
}
