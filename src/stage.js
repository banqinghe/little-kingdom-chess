import * as THREE from 'three/webgpu';
import { Piece } from './piece.js';
import { squarePos } from './world.js';
import { colorOf, typeOf } from './chess.js';

const WALK = 1.15;
const RUN = 2.7;
const ROLL = 1.7;
// how far from its target each attacker stops to strike, in squares
const REACH = { p: 0.58, b: 1.15, q: 1.15, k: 0.72, n: 0.8, r: 1.0 };

const ease = (t) => t * t * (3 - 2 * t);
const angleTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
const shortest = (a, b) => a + ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

export function createStage({ scene, assets, fx, audio, director }) {
  const bySq = new Map();
  const all = new Set();
  const tasks = [];
  let time = 0;
  let fidgetIn = 3;

  // A reset (undo, new game) bumps the generation: tweens and waits from before it never resolve, so a move that
  // was still playing out stops at its next await instead of moving pieces that now belong to the new game.
  let generation = 0;
  const halt = new Promise(() => {});
  const tween = (dur, fn, curve = ease) => new Promise((res) => tasks.push({ t: 0, dur: Math.max(dur, 1e-4), fn, res, curve, gen: generation }));
  const wait = (s) => tween(s, null);
  const guard = (promise) => {
    const gen = generation;
    return promise.then((v) => (gen === generation ? v : halt));
  };

  // pieces off the board wait here by FEN letter, so undo and new games reuse them instead of building new rigs
  const pool = {};

  function spawn(p, sq) {
    const piece = pool[p]?.pop() ?? new Piece(assets, typeOf(p), colorOf(p));
    piece.letter = p;
    piece.restore();
    squarePos(sq, piece.root.position);
    scene.add(piece.root);
    bySq.set(sq, piece);
    all.add(piece);
    return piece;
  }
  function remove(piece) {
    scene.remove(piece.root);
    if (all.delete(piece)) (pool[piece.letter] ??= []).push(piece);
  }

  function reset(board) {
    // a move still playing out belongs to the old game and must not touch the new one; its waits never resolve,
    // so a close-up it would have released (capture or check) is released here
    generation++;
    director.release();
    for (const p of [...all]) remove(p);
    bySq.clear();
    board.forEach((p, sq) => p && spawn(p, sq));
  }

  async function face(piece, yaw, dur = 0.28) {
    const from = piece.root.rotation.y;
    const to = shortest(from, yaw);
    if (Math.abs(to - from) < 0.02) return;
    await tween(dur, (k) => (piece.root.rotation.y = from + (to - from) * k));
  }

  // footsteps, hoofbeats and wheel rumble while something travels
  function stepFx(piece, kind, dt) {
    piece.stepClock = (piece.stepClock ?? 0) + dt;
    const gap = kind === 'run' ? 0.17 : kind === 'gallop' ? 0.11 : kind === 'roll' ? 0.18 : 0.29;
    if (piece.stepClock < gap) return;
    piece.stepClock = 0;
    audio.play(kind === 'gallop' ? 'hoof' : kind === 'roll' ? 'rumble' : 'step');
    if (kind !== 'walk' || Math.random() < 0.4) fx.dust(piece.root.position, kind === 'walk' ? 1 : 2);
  }

  // walks, runs or rolls the piece along a straight line to `to`
  async function travel(piece, to, { speed, kind } = {}) {
    const from = piece.root.position.clone();
    const dist = from.distanceTo(to);
    if (dist < 0.02) return;
    const isTower = piece.type === 'r';
    kind ??= isTower ? 'roll' : piece.type === 'n' ? 'gallop' : dist > 2.2 ? 'run' : 'walk';
    speed ??= kind === 'roll' ? ROLL : kind === 'gallop' ? RUN : kind === 'run' ? RUN : WALK;
    await face(piece, angleTo(from, to));
    piece.setMoving(true, kind);
    if (isTower) piece.lean = 0.12;
    let prev = 0;
    await tween(dist / speed, (k, dt) => {
      piece.root.position.lerpVectors(from, to, k);
      piece.roll((k - prev) * dist);
      prev = k;
      stepFx(piece, kind, dt);
    }, isTower ? ease : (t) => t);
    piece.setMoving(false);
    if (isTower) {
      piece.lean = -0.08;
      wait(0.25).then(() => (piece.lean = 0));
    }
  }

  // the knight leaps in one arc over whatever stands in between
  async function leap(piece, to) {
    const from = piece.root.position.clone();
    await face(piece, angleTo(from, to), 0.22);
    audio.play('neigh');
    piece.horse.once('jump', { speed: 0.9 });
    piece.rider.once('ride_gallop', { speed: 1.4 });
    await wait(0.15);
    fx.dust(from, 4);
    const dist = from.distanceTo(to);
    await tween(0.62, (k) => {
      piece.root.position.lerpVectors(from, to, k);
      piece.root.position.y = Math.sin(k * Math.PI) * (0.35 + dist * 0.12);
    }, (t) => t);
    piece.root.position.y = 0;
    audio.play('land');
    fx.dust(to, 6);
    await wait(0.25);
  }

  async function goHome(piece) {
    await face(piece, piece.homeYaw, 0.3);
  }

  async function strikeFx(attacker, victim, dir) {
    const a = attacker.root.position, v = victim.root.position;
    const yaw = Math.atan2(dir.x, dir.z);
    switch (attacker.type) {
      case 'p': {
        const s = attacker.strike();
        await wait(s.hit - 0.12);
        audio.play('whoosh');
        fx.slash(new THREE.Vector3().lerpVectors(a, v, 0.55).setY(0.42), yaw, '#f4fdff');
        await wait(0.12);
        audio.play('clang');
        return { at: v.clone().setY(0.4), style: 'fall', rest: s.end - s.hit };
      }
      case 'k': {
        const s = attacker.strike();
        await wait(s.hit);
        audio.play('thud');
        fx.shockwave(v, '#fff3c4', 1.6);
        fx.slash(new THREE.Vector3().lerpVectors(a, v, 0.5).setY(0.55), yaw, '#fff1b8', true);
        return { at: v.clone().setY(0.35), style: 'fall', rest: s.end - s.hit, big: true };
      }
      case 'b':
      case 'q': {
        const queen = attacker.type === 'q';
        const s = attacker.strike();
        audio.play('charge');
        await wait(s.hit * 0.75);
        const hand = attacker.root.position.clone().add(dir.clone().multiplyScalar(0.25)).setY(queen ? 0.65 : 0.85);
        fx.sparkles(hand, 12, queen ? '#ffd6f0' : '#bff3ff', 0.2);
        audio.play('magic');
        await guard(fx.orb(hand, v.clone().setY(0.45), queen ? '#ffb3e1' : '#8ff0ff', 0.38));
        audio.play('zap');
        if (queen) fx.hearts(v.clone().setY(0.5), 10);
        fx.sparkles(v.clone().setY(0.45), 18, queen ? '#ffe0f4' : '#d8fbff', 0.35);
        return { at: v.clone().setY(0.45), style: queen ? 'fly' : 'fall', rest: Math.max(0, s.end - s.hit), tint: queen ? '#ffd6ef' : '#d6fbff' };
      }
      case 'n': {
        const s = attacker.strike();
        audio.play('neigh');
        await wait(s.hit - 0.3);
        audio.play('whoosh');
        fx.slash(new THREE.Vector3().lerpVectors(a, v, 0.6).setY(0.75), yaw, '#f4fdff', true);
        await wait(0.3);
        audio.play('thud');
        fx.dust(new THREE.Vector3().lerpVectors(a, v, 0.4), 6);
        return { at: v.clone().setY(0.4), style: 'fly', rest: s.end - s.hit, big: true };
      }
      case 'r': {
        // wind up, then charge straight through the target's square
        attacker.lean = -0.18;
        audio.play('charge');
        await wait(0.35);
        attacker.lean = 0.2;
        const from = a.clone();
        const to = v.clone().sub(dir.clone().multiplyScalar(0.42));
        const dist = from.distanceTo(to);
        let prev = 0;
        attacker.setMoving(true);
        await tween(0.22, (k, dt) => {
          attacker.root.position.lerpVectors(from, to, k);
          attacker.roll((k - prev) * dist);
          prev = k;
          stepFx(attacker, 'roll', dt);
        }, (t) => t * t);
        attacker.setMoving(false);
        attacker.lean = -0.15;
        audio.play('thud');
        return { at: v.clone().setY(0.45), style: 'fly', rest: 0.2, big: true };
      }
    }
  }

  async function capture(move, attacker, victim, target) {
    const vpos = victim.root.position.clone();
    const start = attacker.root.position.clone();
    const dir = vpos.clone().sub(start).setY(0).normalize();
    director.focus(new THREE.Vector3().lerpVectors(start, vpos, 0.6), dir);

    // close in (or not, for spells cast from where the caster stands)
    const reach = REACH[attacker.type];
    const dist = start.distanceTo(vpos);
    if (attacker.type === 'n') {
      const landing = vpos.clone().sub(dir.clone().multiplyScalar(reach));
      await leap(attacker, landing);
    } else if (dist > reach + 0.05) {
      await travel(attacker, vpos.clone().sub(dir.clone().multiplyScalar(reach)));
    } else {
      await face(attacker, angleTo(start, vpos));
    }
    // the victim turns to meet the attacker
    face(victim, angleTo(vpos, attacker.root.position), 0.25);
    if (victim.rig) victim.react('alert', { speed: 2.2 });

    const hit = await strikeFx(attacker, victim, dir);
    fx.impact(hit.at, hit.tint);
    fx.shake = hit.big ? 0.5 : 0.3;
    const fallFor = victim.fall(hit.style);
    if (hit.style === 'fly') {
      // thrown back a little along the blow
      const from = victim.root.position.clone();
      const to = from.clone().add(dir.clone().multiplyScalar(0.45));
      tween(0.55, (k) => victim.root.position.lerpVectors(from, to, k), (t) => 1 - (1 - t) * (1 - t));
    }
    await wait(Math.min(fallFor, 1.05));
    // the fallen piece turns into petals and drifts away
    audio.play('poof');
    fx.petals(victim.root.position, victim.type === 'p' ? 0.5 : 0.75);
    director.release();
    const s0 = victim.root.scale.x;
    await tween(0.3, (k) => victim.root.scale.setScalar(s0 * (1 - k)));
    remove(victim);
    await wait(Math.max(0, hit.rest - 1.5));

    if (attacker.type === 'r') attacker.lean = 0;
    await travel(attacker, target, attacker.type === 'n' ? { kind: 'gallop', speed: 1.6 } : {});
  }

  // plays one move on the board. `after` is the game after the move (for check reactions)
  async function play(move) {
    const attacker = bySq.get(move.from);
    const target = squarePos(move.to, new THREE.Vector3());
    const victimSq = move.ep ?? (move.captured ? move.to : -1);
    const victim = victimSq >= 0 ? bySq.get(victimSq) : null;
    bySq.delete(move.from);
    if (victim) bySq.delete(victimSq);

    if (move.castle) {
      const rook = bySq.get(move.castle[0]);
      bySq.delete(move.castle[0]);
      audio.play('castle');
      const rookTo = squarePos(move.castle[1], new THREE.Vector3());
      // the king steps out in front of the tower so they don't pass through each other
      const bulge = attacker.color === 'w' ? -0.55 : 0.55;
      const kingMid = new THREE.Vector3().lerpVectors(attacker.root.position, target, 0.5).add(new THREE.Vector3(0, 0, bulge));
      await Promise.all([
        (async () => {
          await travel(attacker, kingMid);
          await travel(attacker, target);
          await goHome(attacker);
        })(),
        (async () => {
          await wait(0.5);
          await travel(rook, rookTo);
          await goHome(rook);
        })(),
      ]);
      bySq.set(move.castle[1], rook);
    } else if (victim) {
      await capture(move, attacker, victim, target);
      await goHome(attacker);
    } else if (attacker.type === 'n') {
      await leap(attacker, target);
      await goHome(attacker);
    } else {
      await travel(attacker, target);
      await goHome(attacker);
    }
    bySq.set(move.to, attacker);
    if (move.promo) await promote(attacker, move.to, move.promo);
  }

  async function promote(pawn, sq, promo) {
    const at = pawn.root.position.clone();
    audio.play('promote');
    fx.pillar(at);
    fx.sparkles(at.clone().setY(0.5), 24, '#fff3c0', 0.5);
    pawn.react('cheer');
    await wait(0.6);
    await tween(0.35, (k) => pawn.root.scale.setScalar(1 - k));
    remove(pawn);
    const next = spawn(promo, sq);
    next.root.scale.setScalar(0.01);
    fx.petals(at, 0.6);
    await tween(0.45, (k) => next.root.scale.setScalar(Math.max(0.01, k)), (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2);
    next.react('cheer');
  }

  return {
    bySq,
    reset,
    play,
    wait,
    pieces: () => all,
    // a piece hops to show it was picked up
    lift(sq) {
      const p = bySq.get(sq);
      if (p) p.hop = 1;
    },
    // the king's reaction to being in check
    alarm(sq) {
      const k = bySq.get(sq);
      if (!k) return;
      if (k.rig) k.react('hit', { speed: 1.2 });
      fx.exclaim(k.root.position.clone().setY(1.3));
    },
    // everyone on the winning side celebrates, the losing king kneels
    celebrate(winner) {
      let i = 0;
      for (const p of all) {
        const delay = 0.08 * i++;
        if (p.color === winner) wait(delay).then(() => p.react(p.type === 'k' || p.type === 'q' ? 'dance' : 'cheer'));
        else if (p.type === 'k') wait(0.4).then(() => p.react('kneel', { hold: true }));
      }
    },
    bowAll() {
      let i = 0;
      for (const p of all) wait(0.05 * i++).then(() => p.react('bow'));
    },
    update(dt) {
      time += dt;
      for (let i = tasks.length - 1; i >= 0; i--) {
        const t = tasks[i];
        if (t.gen !== generation) {
          tasks.splice(i, 1);
          continue;
        }
        t.t += dt;
        const k = Math.min(1, t.t / t.dur);
        t.fn?.(t.curve(k), dt);
        if (k >= 1) {
          tasks.splice(i, 1);
          t.res();
        }
      }
      for (const p of all) p.update(dt, time);
      // now and then someone on the board fidgets
      fidgetIn -= dt;
      if (fidgetIn <= 0) {
        fidgetIn = 2.5 + Math.random() * 3.5;
        const list = [...all];
        list[Math.floor(Math.random() * list.length)]?.fidget?.();
      }
    },
  };
}
