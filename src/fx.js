import * as THREE from 'three/webgpu';
import { color, smoothstep, uniform, uv } from 'three/tsl';

// every particle texture is painted on a canvas at startup: nothing extra to download
function paint(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const TEX = {
  soft: paint(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  }),
  puff: paint(64, (g, s) => {
    g.fillStyle = '#fff';
    for (const [x, y, r] of [[32, 36, 18], [20, 30, 12], [44, 30, 13], [32, 22, 13]]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }),
  star: paint(64, (g, s) => {
    g.fillStyle = '#fff';
    g.strokeStyle = 'rgba(60,70,90,0.55)';
    g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 11 : 26;
      g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.stroke();
  }),
  sparkle: paint(64, (g, s) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(32, 2);
    g.quadraticCurveTo(36, 28, 62, 32);
    g.quadraticCurveTo(36, 36, 32, 62);
    g.quadraticCurveTo(28, 36, 2, 32);
    g.quadraticCurveTo(28, 28, 32, 2);
    g.fill();
  }),
  petal: paint(64, (g) => {
    g.fillStyle = '#fff';
    g.strokeStyle = 'rgba(80,60,70,0.35)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(32, 6);
    g.bezierCurveTo(56, 20, 50, 50, 32, 58);
    g.bezierCurveTo(14, 50, 8, 20, 32, 6);
    g.fill();
    g.stroke();
  }),
  // a speech-bubble "!" for a king in check
  alarm: paint(128, (g) => {
    g.fillStyle = '#ff7a6b';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 8;
    g.beginPath();
    g.arc(64, 58, 44, 0, Math.PI * 2);
    g.moveTo(52, 98);
    g.lineTo(64, 122);
    g.lineTo(76, 98);
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = 'bold 64px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('!', 64, 62);
  }),
  heart: paint(64, (g) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(32, 56);
    g.bezierCurveTo(4, 36, 8, 8, 32, 20);
    g.bezierCurveTo(56, 8, 60, 36, 32, 56);
    g.fill();
  }),
};

const PETALS = ['#ffd6e0', '#fff4c2', '#ffffff', '#cfeaff', '#ffc9b8'];

export function createFx(scene, camera) {
  const pool = [];
  const live = [];
  const effects = [];
  // each sprite owns its material: colour, opacity and rotation are per particle
  const material = (tex, additive) => new THREE.SpriteNodeMaterial({ map: tex, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  function sprite(tex, additive) {
    let s = pool.find((p) => !p.visible && p.userData.tex === tex && p.userData.additive === additive);
    if (!s) {
      s = new THREE.Sprite(material(tex, additive));
      s.userData.tex = tex;
      s.userData.additive = additive;
      s.renderOrder = 5;
      pool.push(s);
      scene.add(s);
    }
    s.visible = true;
    return s;
  }

  // p: { tex, at, vel, life, size, grow, gravity, drag, spin, color, additive, fade }
  function emit(p) {
    const s = sprite(p.tex ?? TEX.soft, !!p.additive);
    s.position.copy(p.at);
    s.material.color.set(p.color ?? '#ffffff');
    s.material.rotation = p.rot ?? Math.random() * Math.PI * 2;
    s.material.opacity = 1;
    s.scale.setScalar(p.size ?? 0.1);
    live.push({ s, vel: p.vel?.clone() ?? new THREE.Vector3(), age: 0, life: p.life ?? 0.8, size: p.size ?? 0.1, grow: p.grow ?? 0, gravity: p.gravity ?? 0, drag: p.drag ?? 0, spin: p.spin ?? 0, fade: p.fade ?? 0.5, flutter: p.flutter ?? 0 });
  }

  const rand = (a, b) => a + Math.random() * (b - a);
  const dir = () => new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();

  const api = {
    TEX,
    emit,
    // soft dust kicked up by feet, hooves and wheels
    dust(at, n = 3, tint = '#f1ead2') {
      for (let i = 0; i < n; i++) {
        emit({ tex: TEX.puff, at: at.clone().add(new THREE.Vector3(rand(-0.12, 0.12), 0.04, rand(-0.12, 0.12))), vel: new THREE.Vector3(rand(-0.2, 0.2), rand(0.15, 0.4), rand(-0.2, 0.2)), life: rand(0.5, 0.8), size: rand(0.08, 0.14), grow: 0.35, drag: 2, color: tint, fade: 0.4 });
      }
    },
    // cartoon stars and a flash where a blow lands
    impact(at, tint = '#fff3b0') {
      emit({ tex: TEX.soft, at, life: 0.25, size: 0.5, grow: 2.5, color: '#ffffff', additive: true, fade: 0.9 });
      for (let i = 0; i < 9; i++) {
        const d = dir();
        d.y = Math.abs(d.y) * 0.8 + 0.2;
        emit({ tex: TEX.star, at: at.clone(), vel: d.multiplyScalar(rand(1.4, 2.4)), life: rand(0.5, 0.75), size: rand(0.1, 0.17), gravity: -4, drag: 1.5, spin: rand(-8, 8), color: i % 3 ? tint : '#ffffff', fade: 0.3 });
      }
    },
    // the defeated piece turns into petals and sparkles that drift off
    petals(at, height = 0.7) {
      for (let i = 0; i < 26; i++) {
        const p = at.clone().add(new THREE.Vector3(rand(-0.25, 0.25), rand(0.05, height), rand(-0.25, 0.25)));
        emit({ tex: TEX.petal, at: p, vel: new THREE.Vector3(rand(-0.6, 0.6), rand(0.6, 1.5), rand(-0.6, 0.6)), life: rand(1.1, 1.8), size: rand(0.06, 0.1), gravity: -0.6, drag: 1.2, spin: rand(-4, 4), flutter: rand(2, 5), color: PETALS[i % PETALS.length], fade: 0.5 });
      }
      for (let i = 0; i < 12; i++) {
        const p = at.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(0.1, height), rand(-0.3, 0.3)));
        emit({ tex: TEX.sparkle, at: p, vel: new THREE.Vector3(0, rand(0.3, 0.8), 0), life: rand(0.6, 1), size: rand(0.08, 0.16), color: '#fffbe6', additive: true, spin: rand(-2, 2), fade: 0.6 });
      }
      emit({ tex: TEX.soft, at: at.clone().setY(at.y + height * 0.5), life: 0.5, size: 0.6, grow: 1.5, color: '#fff8dd', additive: true, fade: 0.9 });
    },
    sparkles(at, n = 10, tint = '#bff3ff', spread = 0.4) {
      for (let i = 0; i < n; i++) {
        emit({ tex: TEX.sparkle, at: at.clone().add(dir().multiplyScalar(rand(0, spread))), vel: dir().multiplyScalar(rand(0.2, 0.7)), life: rand(0.5, 0.9), size: rand(0.06, 0.13), color: tint, additive: true, spin: rand(-3, 3), fade: 0.6 });
      }
    },
    // pops up over the king's head, wobbles, and fades
    exclaim(at) {
      const s = sprite(TEX.alarm, false);
      s.position.copy(at);
      s.material.rotation = 0;
      s.material.opacity = 1;
      s.material.color.set('#ffffff');
      s.renderOrder = 6;
      effects.push({
        t: 0, dur: 1.6,
        update: (k) => {
          const pop = k < 0.15 ? 1.25 * Math.sin((k / 0.15) * Math.PI / 2) : 1 + 0.25 * Math.max(0, 1 - (k - 0.15) * 6) * Math.cos((k - 0.15) * 40);
          s.scale.setScalar(0.34 * pop);
          s.position.y = at.y + Math.sin(k * Math.PI * 3) * 0.03;
          s.material.rotation = Math.sin(k * 30) * 0.15 * (1 - k);
          s.material.opacity = k > 0.8 ? (1 - k) / 0.2 : 1;
        },
        done: () => (s.visible = false),
      });
    },
    hearts(at, n = 8) {
      for (let i = 0; i < n; i++) {
        emit({ tex: TEX.heart, at: at.clone().add(dir().multiplyScalar(0.15)), vel: new THREE.Vector3(rand(-0.6, 0.6), rand(0.6, 1.4), rand(-0.6, 0.6)), life: rand(0.8, 1.2), size: rand(0.07, 0.12), color: ['#ffb3c7', '#ffd1dc', '#ff9eb5'][i % 3], gravity: -0.5, drag: 1, fade: 0.5 });
      }
    },
    confetti(center, n = 120) {
      for (let i = 0; i < n; i++) {
        const at = center.clone().add(new THREE.Vector3(rand(-4, 4), rand(2.5, 4.5), rand(-4, 4)));
        emit({ tex: i % 4 ? TEX.petal : TEX.star, at, vel: new THREE.Vector3(rand(-0.3, 0.3), rand(-0.6, -0.2), rand(-0.3, 0.3)), life: rand(3, 5), size: rand(0.07, 0.12), gravity: -0.15, drag: 0.4, spin: rand(-5, 5), flutter: rand(2, 6), color: PETALS[i % PETALS.length], fade: 0.25 });
      }
    },

    // a crescent of light swept in front of the attacker
    slash(at, yaw, tint = '#eafcff', flip = false) {
      const geo = new THREE.RingGeometry(0.28, 0.46, 32, 1, -Math.PI * 0.55, Math.PI * 1.1);
      const progress = uniform(0);
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      // the bright edge leads the sweep and the tail fades behind it
      const along = uv().x;
      const edge = smoothstep(0.0, 0.9, uv().y);
      m.colorNode = color(tint);
      m.opacityNode = smoothstep(progress.sub(0.5), progress, along).mul(smoothstep(progress.add(0.02), progress, along)).mul(edge).mul(progress.oneMinus().mul(1.4).min(1));
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.copy(at);
      mesh.rotation.set(flip ? -0.5 : 0.5, yaw + Math.PI / 2, flip ? Math.PI : 0, 'YXZ');
      scene.add(mesh);
      effects.push({ t: 0, dur: 0.32, update: (k) => progress.value = k * 1.3, done: () => (scene.remove(mesh), geo.dispose(), m.dispose()) });
    },

    // a ring that runs out along the ground
    shockwave(at, tint = '#fff6d0', reach = 1.4) {
      const geo = new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2);
      const m = new THREE.MeshBasicNodeMaterial({ color: tint, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.copy(at).setY(0.05);
      scene.add(mesh);
      effects.push({ t: 0, dur: 0.55, update: (k) => { mesh.scale.setScalar(0.1 + k * reach); m.opacity = (1 - k) * 0.9; }, done: () => (scene.remove(mesh), geo.dispose(), m.dispose()) });
    },

    // a glowing orb flying from a to b; resolves on arrival
    orb(a, b, tint = '#9ff0ff', dur = 0.4, trail = TEX.sparkle) {
      return new Promise((resolve) => {
        const p = new THREE.Vector3();
        let last = 0;
        effects.push({
          t: 0, dur,
          update: (k, dt) => {
            p.lerpVectors(a, b, k);
            p.y += Math.sin(k * Math.PI) * 0.35;
            emit({ tex: TEX.soft, at: p, life: 0.12, size: 0.28, color: tint, additive: true, fade: 0.9 });
            last += dt;
            if (last > 0.02) {
              last = 0;
              emit({ tex: trail, at: p.clone(), vel: dir().multiplyScalar(0.3), life: 0.5, size: rand(0.05, 0.1), color: '#ffffff', additive: true, spin: 3, fade: 0.5 });
            }
          },
          done: resolve,
        });
      });
    },

    // a column of light for promotions
    pillar(at) {
      const geo = new THREE.CylinderGeometry(0.32, 0.4, 3, 24, 1, true).translate(0, 1.5, 0);
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      const fade = uniform(0);
      m.colorNode = color('#fff6c8');
      m.opacityNode = smoothstep(1, 0, uv().y).mul(fade);
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.copy(at);
      scene.add(mesh);
      effects.push({ t: 0, dur: 1.6, update: (k) => { fade.value = Math.sin(k * Math.PI) * 0.8; mesh.rotation.y += 0.05; }, done: () => (scene.remove(mesh), geo.dispose(), m.dispose()) });
    },

    // every effect once, while the loading screen still covers the canvas, so no shader compiles mid-game
    warm(at) {
      for (const tex of Object.values(TEX)) {
        emit({ tex, at, life: 0.05 });
        emit({ tex, at, life: 0.05, additive: true });
      }
      api.slash(at, 0);
      api.shockwave(at);
      api.pillar(at);
      api.orb(at, at.clone().add(new THREE.Vector3(0.1, 0, 0)), '#ffffff', 0.05);
    },
    shake: 0,
    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        p.age += dt;
        const k = p.age / p.life;
        if (k >= 1) {
          p.s.visible = false;
          live.splice(i, 1);
          continue;
        }
        p.vel.y += p.gravity * dt;
        p.vel.multiplyScalar(Math.exp(-p.drag * dt));
        p.s.position.addScaledVector(p.vel, dt);
        if (p.flutter) p.s.position.x += Math.sin(p.age * p.flutter) * dt * 0.3;
        p.s.material.rotation += p.spin * dt;
        p.s.scale.setScalar(p.size * (1 + p.grow * k));
        p.s.material.opacity = k < 1 - p.fade ? 1 : (1 - k) / p.fade;
      }
      for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i];
        e.t += dt;
        const k = Math.min(1, e.t / e.dur);
        e.update(k, dt);
        if (k >= 1) {
          effects.splice(i, 1);
          e.done?.();
        }
      }
      api.shake = Math.max(0, api.shake - dt * 2.5);
    },
  };
  return api;
}
