import * as THREE from 'three/webgpu';
import { toonOutlinePass } from 'three/tsl';
import { createWorld, squarePos } from './world.js';
import { loadAssets } from './assets.js';
import { createStage } from './stage.js';
import { addScenery } from './scenery.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { Chess, colorOf, moveKey, typeOf, sqName } from './chess.js';
import { LANGS, lang, onLang, setLang, t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const SAVE = 'little-kingdom-chess.game';
const SETTINGS = 'little-kingdom-chess.settings';
const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

// any startup failure (no WebGPU/WebGL, a missing model) should say so instead of leaving a frozen loading screen
const showError = (err) => {
  $('loading').classList.add('failed');
  $('load-text').textContent = t('Failed to load: ') + (err?.message ?? err);
};
addEventListener('error', (e) => showError(e.error ?? e.message));
addEventListener('unhandledrejection', (e) => showError(e.reason));

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
await renderer.init();
$('backend').textContent = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#d8eef7', 30, 70);
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 400);
scene.add(new THREE.HemisphereLight('#fff6e0', '#8fb0c8', 1.35));
const sun = new THREE.DirectionalLight('#fff1d6', 2.5);
sun.position.set(-5, 11, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
scene.add(sun);

const world = createWorld(scene);
const fx = createFx(scene, camera);
const audio = createAudio();

const assets = await loadAssets((f) => {
  $('load-bar').style.width = `${Math.round(f * 100)}%`;
  $('load-text').textContent = t('Loading… {0}%', Math.round(f * 100));
});
addScenery(scene, assets);

// ---------- camera ----------
const VIEW = { yaw: 0, pitch: 0.8, zoom: 1 };
const portrait = () => camera.aspect < 0.85;
const PITCH = [0.45, 1.35];
const ZOOM = [0.55, 1.5];
const settings = { cine: true, ...store.get(SETTINGS) };
const focus = { on: false, point: new THREE.Vector3(), yaw: 0, k: 0 };
const director = {
  // a close-up from the side of the fight, on whichever side is nearer the current view
  // returns a token; release(token) only ends that close-up, not a newer one
  focus(point, dir) {
    if (!settings.cine) return 0;
    focus.on = true;
    focus.id = (focus.id ?? 0) + 1;
    focus.point.copy(point);
    const side = Math.atan2(dir.x, dir.z) + Math.PI / 2;
    const near = (a) => Math.abs(Math.atan2(Math.sin(a - VIEW.yaw), Math.cos(a - VIEW.yaw)));
    focus.yaw = (near(side) < near(side + Math.PI) ? side : side + Math.PI) + 0.4 * Math.sign(Math.sin(VIEW.yaw - side) || 1);
    return focus.id;
  },
  release(token) {
    if (token === undefined || token === focus.id) focus.on = false;
  },
};
let attract = true;
function frameDistance() {
  // fit the 8-square board plus a margin across the narrower screen dimension
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  return Math.max(4.8 / Math.tan(vfov / 2), (portrait() ? 4.9 : 4.8) / Math.tan(hfov / 2)) * 0.98;
}
const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const cinePos = new THREE.Vector3();
const cineLook = new THREE.Vector3();
function updateCamera(dt) {
  if (attract) VIEW.yaw += dt * 0.08;
  focus.k += ((focus.on ? 1 : 0) - focus.k) * (1 - Math.exp(-dt * 3.2));
  const k = focus.k * focus.k * (3 - 2 * focus.k);
  const dist = frameDistance() * VIEW.zoom;
  const pitch = portrait() ? Math.max(VIEW.pitch, 1.12) : VIEW.pitch;
  camPos.set(Math.sin(VIEW.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(VIEW.yaw) * Math.cos(pitch)).multiplyScalar(dist);
  lookAt.set(0, 0.2, 0);
  if (k > 0.001) {
    cineLook.copy(focus.point).setY(0.4);
    cinePos.set(Math.sin(focus.yaw) * Math.cos(0.36), Math.sin(0.36), Math.cos(focus.yaw) * Math.cos(0.36)).multiplyScalar(4.6).add(cineLook);
    camPos.lerp(cinePos, k);
    lookAt.lerp(cineLook, k);
  }
  if (fx.shake > 0) camPos.add(new THREE.Vector3((Math.random() - 0.5) * fx.shake * 0.12, (Math.random() - 0.5) * fx.shake * 0.12, 0));
  camera.position.copy(camPos);
  camera.lookAt(lookAt);
}
let yawGoal = null;
function turnCamera(yaw) {
  yawGoal = VIEW.yaw + (((yaw - VIEW.yaw) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
}

// ---------- markers on the lawn ----------
function paintTex(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  draw(c.getContext('2d'));
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}
const MARK = {
  // a little daisy for each square the picked piece can walk to
  move: paintTex((g) => {
    const glow = g.createRadialGradient(64, 64, 20, 64, 64, 64);
    glow.addColorStop(0, 'rgba(255,255,240,0.75)');
    glow.addColorStop(1, 'rgba(255,255,240,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, 128, 128);
    g.translate(64, 64);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.strokeStyle = 'rgba(70,110,90,0.5)';
    g.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      g.save();
      g.rotate((i * Math.PI) / 3);
      g.beginPath();
      g.ellipse(0, -20, 9, 15, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.restore();
    }
    g.fillStyle = '#ffd34d';
    g.beginPath();
    g.arc(0, 0, 10, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }),
  capture: paintTex((g) => {
    g.strokeStyle = 'rgba(255,120,100,0.95)';
    g.lineWidth = 9;
    g.setLineDash([16, 11]);
    g.beginPath();
    g.arc(64, 64, 50, 0, Math.PI * 2);
    g.stroke();
  }),
  select: paintTex((g) => {
    const r = g.createRadialGradient(64, 64, 30, 64, 64, 62);
    r.addColorStop(0, 'rgba(255,240,170,0)');
    r.addColorStop(0.65, 'rgba(255,236,150,0.9)');
    r.addColorStop(1, 'rgba(255,236,150,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  }),
  square: paintTex((g) => {
    g.fillStyle = 'rgba(255,248,200,0.55)';
    g.beginPath();
    g.roundRect(6, 6, 116, 116, 14);
    g.fill();
  }),
  hover: paintTex((g) => {
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(8, 8, 112, 112, 16);
    g.stroke();
  }),
  check: paintTex((g) => {
    const r = g.createRadialGradient(64, 64, 10, 64, 64, 62);
    r.addColorStop(0, 'rgba(255,90,80,0.85)');
    r.addColorStop(1, 'rgba(255,90,80,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  }),
};
const markGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const markers = new THREE.Group();
scene.add(markers);
const markPool = [];
let markUsed = 0;
function mark(tex, sq, size = 1, y = 0.08) {
  let m = markPool[markUsed];
  if (!m) {
    m = new THREE.Mesh(markGeo, new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false }));
    m.renderOrder = 3;
    markPool.push(m);
    markers.add(m);
  }
  markUsed++;
  m.material.map = tex;
  m.material.needsUpdate = true;
  m.visible = true;
  squarePos(sq, m.position).setY(y);
  m.scale.setScalar(size);
  m.userData.kind = tex;
  return m;
}

// ---------- game ----------
const stage = createStage({ scene, assets, fx, audio, director });
let chess = new Chess();
let game = null; // { mode: 'ai' | 'local', level, human: 'w' | 'b', history: [] }
let busy = false;
let picking = false;
let selected = -1;
let legal = [];
let hoverSq = -1;
let lastMove = null;
let over = null;
let thinking = false;
let worker = null;

const TEAM = { get w() { return t('Pale blue'); }, get b() { return t('Deep teal'); } };
const PIECE_NAMES = { get p() { return t('Soldier'); }, get n() { return t('Knight'); }, get b() { return t('Wizard'); }, get r() { return t('Tower'); }, get q() { return t('Queen'); }, get k() { return t('King'); } };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function refreshMarkers() {
  markUsed = 0;
  if (lastMove) {
    mark(MARK.square, lastMove.from, 0.96, 0.03);
    mark(MARK.square, lastMove.to, 0.96, 0.03);
  }
  if (!over && chess.inCheck()) mark(MARK.check, chess.king(chess.turn), 1.5, 0.05);
  if (selected >= 0) {
    mark(MARK.select, selected, 1.3, 0.06);
    const seen = new Set();
    for (const m of legal) {
      if (seen.has(m.to)) continue;
      seen.add(m.to);
      if (m.captured) mark(MARK.capture, m.ep ?? m.to, 0.95);
      else mark(MARK.move, m.to, 0.5);
    }
  }
  if (hoverSq >= 0 && !busy) mark(MARK.hover, hoverSq, 0.98, 0.04);
  for (let i = markUsed; i < markPool.length; i++) markPool[i].visible = false;
}

const humanTurn = () => game && !over && !busy && !picking && !thinking && (game.mode === 'local' || chess.turn === game.human);

function select(sq) {
  selected = sq;
  legal = sq >= 0 ? chess.moves().filter((m) => m.from === sq) : [];
  if (sq >= 0) {
    stage.lift(sq);
    audio.play('select');
    if (!legal.length) explainStuck(sq);
  }
  refreshMarkers();
}

// a picked piece with nowhere to go gets a reason, the usual one being a king in check
function explainStuck(sq) {
  if (chess.inCheck()) {
    hint(t('Your king is in check: protect him first!'), true);
    stage.alarm(chess.king(chess.turn));
    audio.play('check');
  } else if (chess.pseudo().some((m) => m.from === sq)) hint(t('It can’t move: that would leave your king in check.'));
  else hint(t('It has no room to move right now.'));
}
let hintTimer = 0;
function hint(text, warn = false) {
  const h = $('hint');
  h.textContent = text;
  h.className = warn ? 'show warn' : 'show';
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => (h.className = ''), 2600);
}

function onSquare(sq) {
  if (!humanTurn() || sq < 0) return;
  const p = chess.board[sq];
  if (p && colorOf(p) === chess.turn) {
    if (sq === selected) {
      select(-1);
      audio.play('deselect');
    } else select(sq);
    return;
  }
  if (selected < 0) return;
  // an en passant ring sits on the pawn being taken, not on the square the soldier moves to
  const options = legal.filter((m) => m.to === sq || m.ep === sq);
  if (!options.length) {
    select(-1);
    audio.play('deselect');
    return;
  }
  if (options.length > 1) {
    // nothing may change the position while the promotion is being picked (undo above all); the move isn't made
    // yet, so this is not `busy`, which the turn pill reads as "the other side is up"
    const forGame = game;
    picking = true;
    updateHud();
    pickPromotion().then((promo) => {
      picking = false;
      if (game !== forGame || !promo) return;
      commit(options.find((m) => m.promo.toLowerCase() === promo));
    });
  } else commit(options[0]);
}

let cancelPromotion = null;
function pickPromotion() {
  return new Promise((resolve) => {
    $('promo').hidden = false;
    const close = (v) => {
      $('promo').hidden = true;
      $('promo-pick').removeEventListener('click', pick);
      cancelPromotion = null;
      resolve(v);
    };
    const pick = (e) => {
      const v = e.target.closest('button')?.dataset.v;
      if (v) close(v);
    };
    $('promo-pick').addEventListener('click', pick);
    cancelPromotion = () => close(null);
  });
}

async function commit(move) {
  busy = true;
  const san = chess.san(move);
  chess.make(move);
  game.history.push(moveKey(move));
  game.sans.push(san);
  store.set(SAVE, game);
  select(-1);
  lastMove = null;
  refreshMarkers();
  updateHud();
  await stage.play(move);
  lastMove = move;
  busy = false;
  afterMove();
}

function afterMove() {
  const result = chess.result();
  refreshMarkers();
  updateHud();
  if (result) return finish(result);
  if (chess.inCheck()) {
    audio.play('check');
    const king = chess.king(chess.turn);
    stage.alarm(king);
    banner(t('Check!'), true);
    // a short close-up of the king, from the side the camera is already on
    const face = VIEW.yaw - Math.PI / 2;
    const shot = director.focus(squarePos(king, new THREE.Vector3()), new THREE.Vector3(Math.sin(face), 0, Math.cos(face)));
    stage.wait(1.8).then(() => director.release(shot));
  }
  if (game.mode === 'local') turnCamera(chess.turn === 'w' ? 0 : Math.PI);
  if (game.mode === 'ai' && chess.turn !== game.human) think();
}

function think() {
  thinking = true;
  updateHud();
  worker ??= new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
  const started = performance.now();
  const forGame = game;
  worker.onmessage = async ({ data }) => {
    // a short pause even for instant answers, so the reply doesn't feel mechanical
    const pause = Math.max(0, 700 - (performance.now() - started));
    await stage.wait(pause / 1000);
    if (game !== forGame) return;
    thinking = false;
    const move = chess.moves().find((m) => moveKey(m) === data);
    commit(move);
  };
  worker.postMessage({ history: game.history, level: game.level });
}

function finish(result) {
  over = result;
  store.set(SAVE, null);
  refreshMarkers();
  updateHud();
  if (result === 'checkmate') {
    const winner = chess.turn === 'w' ? 'b' : 'w';
    stage.celebrate(winner);
    fx.confetti(new THREE.Vector3(0, 0, 0));
    audio.play(game.mode !== 'ai' || winner === game.human ? 'win' : 'lose');
    banner(t('Checkmate!'));
  } else {
    stage.bowAll();
    audio.play('draw');
  }
  clearTimeout(overTimer);
  overTimer = setTimeout(() => {
    paintOver();
    $('over').hidden = false;
  }, 1800);
}
// the result dialog's text, rebuilt when the language changes while it is open
function paintOver() {
  let title, text;
  if (over === 'checkmate') {
    const winner = chess.turn === 'w' ? 'b' : 'w';
    const humanWon = game.mode === 'ai' ? winner === game.human : true;
    if (game.mode === 'ai') title = humanWon ? t('You win!') : t('The computer wins');
    else title = t('{0} wins!', TEAM[winner]);
    text = humanWon || game.mode === 'local' ? t('The meadow cheers for the victors.') : t('Have another go: the computer is waiting.');
  } else {
    title = t('Draw');
    text = {
      stalemate: t('Stalemate: no legal move, but no check either.'),
      fifty: t('Fifty moves without a capture or a soldier step.'),
      repetition: t('The same position came up three times.'),
      material: t('Neither side has enough left to checkmate.'),
    }[over];
  }
  $('over-title').textContent = title;
  $('over-text').textContent = text;
}
let overTimer = 0;
function hideOver() {
  clearTimeout(overTimer);
  $('over').hidden = true;
}

function undo() {
  if (!game || busy || picking || thinking || !game.history.length) return;
  const steps = game.mode === 'ai' ? (chess.turn === game.human ? 2 : 1) : 1;
  for (let i = 0; i < steps && game.history.length; i++) {
    chess.unmake();
    game.history.pop();
    game.sans.pop();
  }
  // in a game against the computer, never stop on its turn
  if (game.mode === 'ai' && chess.turn !== game.human && game.history.length) {
    chess.unmake();
    game.history.pop();
    game.sans.pop();
  }
  over = null;
  hideOver();
  lastMove = chess.stack.at(-1)?.m ?? null;
  store.set(SAVE, game);
  stage.reset(chess.board);
  select(-1);
  updateHud();
  audio.play('click');
  if (game.mode === 'ai' && chess.turn !== game.human) think();
}

function start(g) {
  cancelPromotion?.();
  picking = false;
  game = { sans: [], history: [], ...g };
  chess = new Chess();
  for (const key of game.history) chess.make(chess.moves().find((m) => moveKey(m) === key));
  over = null;
  busy = false;
  thinking = false;
  worker?.terminate();
  worker = null;
  lastMove = chess.stack.at(-1)?.m ?? null;
  stage.reset(chess.board);
  select(-1);
  attract = false;
  VIEW.zoom = 1;
  turnCamera(game.mode === 'ai' ? (game.human === 'w' ? 0 : Math.PI) : chess.turn === 'w' ? 0 : Math.PI);
  $('menu').hidden = true;
  hideOver();
  $('hud').hidden = false;
  store.set(SAVE, game);
  updateHud();
  const result = chess.result();
  if (result) finish(result);
  else if (game.mode === 'ai' && chess.turn !== game.human) think();
}

// ---------- HUD ----------
function updateHud() {
  if (!game) return;
  const turn = $('turn');
  // while a move plays out, and after a mate, the pill shows the side that just moved
  const side = busy || over === 'checkmate' ? (chess.turn === 'w' ? 'b' : 'w') : chess.turn;
  turn.className = `pill ${side}${thinking ? ' thinking' : ''}${chess.inCheck() && !over && !busy ? ' check' : ''}`;
  let text;
  if (over === 'checkmate') text = game.mode === 'ai' ? (side === game.human ? t('You win!') : t('Computer wins')) : t('{0} wins', TEAM[side]);
  else if (over) text = t('Draw');
  else if (thinking) text = t('Thinking…');
  else if (game.mode === 'ai') text = side === game.human ? t('Your move') : t('Computer’s move');
  else text = t('{0} to move', TEAM[side]);
  $('turn-text').textContent = text;

  // captured pieces, shown on the side that took them, with the material lead
  const taken = { w: [], b: [] };
  for (const { m } of chess.stack) if (m.captured) taken[colorOf(m.piece)].push(m.captured);
  const lead = taken.w.reduce((s, p) => s + VALUE[typeOf(p)], 0) - taken.b.reduce((s, p) => s + VALUE[typeOf(p)], 0);
  for (const side of ['w', 'b']) {
    const tray = $(`tray-${side}`);
    const html = taken[side].sort((a, b) => VALUE[typeOf(b)] - VALUE[typeOf(a)]).map((p) => `<img src="icons/${typeOf(p)}${colorOf(p)}.webp" alt="${PIECE_NAMES[typeOf(p)]}" title="${PIECE_NAMES[typeOf(p)]}" />`).join('');
    const adv = (side === 'w' ? lead : -lead) > 0 ? `<span class="adv">+${Math.abs(lead)}</span>` : '';
    tray.innerHTML = html + adv;
  }
  // the move list in figurines: each move shows the little portrait of the piece that made it
  const cell = (i) => {
    const m = chess.stack[i]?.m, san = game.sans[i];
    if (!m || !san) return '<span></span>';
    const mark = san.endsWith('#') ? '<i class="ck mate">#</i>' : san.endsWith('+') ? '<i class="ck">+</i>' : '';
    const body = san.replace(/[+#]$/, '').replace(/^[NBRQK]/, '').replace('x', '<i class="x">×</i>');
    return `<span class="mv${i === chess.stack.length - 1 ? ' last' : ''}"><img src="icons/${typeOf(m.piece)}${colorOf(m.piece)}.webp" alt="" />${body}${mark}</span>`;
  };
  let list = '';
  for (let i = 0; i < game.sans.length; i += 2) list += `<li><i class="n">${i / 2 + 1}</i>${cell(i)}${cell(i + 1)}</li>`;
  const moves = $('moves');
  moves.innerHTML = list;
  moves.scrollTop = moves.scrollHeight;
  $('log').hidden = !game.sans.length;
  $('log-count').textContent = game.sans.length ? t('{0} turns', Math.ceil(game.sans.length / 2)) : '';
  $('btn-undo').disabled = !game.history.length || busy || picking || thinking;
}

let bannerTimer = 0;
function banner(text, warn = false) {
  const b = $('banner');
  b.querySelector('span').textContent = text;
  b.className = '';
  void b.offsetWidth;
  b.className = `show${warn ? ' warn' : ''}`;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => (b.className = ''), 1900);
}

// ---------- menu ----------
const choice = { mode: 'ai', level: 1, side: 'w', ...store.get(SETTINGS)?.choice };
function chips(id, key) {
  const box = $(id);
  const paint = () => {
    for (const b of box.children) b.classList.toggle('on', b.dataset.v === String(choice[key]));
    for (const el of document.querySelectorAll('.ai-only')) el.hidden = choice.mode !== 'ai';
  };
  box.addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (v === undefined) return;
    choice[key] = key === 'level' ? +v : v;
    audio.play('click');
    saveSettings();
    paint();
  });
  paint();
}
function saveSettings() {
  store.set(SETTINGS, { cine: settings.cine, logClosed: $('log').classList.contains('closed'), choice });
}
chips('opt-mode', 'mode');
chips('opt-level', 'level');
chips('opt-side', 'side');
const langBox = $('opt-lang');
for (const [code, name] of Object.entries(LANGS)) {
  const b = document.createElement('button');
  b.dataset.v = code;
  b.textContent = name;
  langBox.appendChild(b);
}
const paintLang = (l) => { for (const b of langBox.children) b.classList.toggle('on', b.dataset.v === l); };
paintLang(lang);
langBox.addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.v;
  if (!v) return;
  audio.play('click');
  setLang(v);
});
onLang((l) => {
  paintLang(l);
  updateHud();
  if (over && !$('over').hidden) paintOver();
});
function openMenu() {
  const saved = store.get(SAVE);
  $('btn-resume').hidden = !(game && !over) && !(saved?.history?.length);
  $('menu').hidden = false;
}
$('btn-start').onclick = () => {
  audio.play('click');
  const human = choice.side === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : choice.side;
  start({ mode: choice.mode, level: choice.level, human });
};
$('btn-resume').onclick = () => {
  audio.play('click');
  if (game && !over) {
    $('menu').hidden = true;
    return;
  }
  start(store.get(SAVE));
};
$('btn-again').onclick = () => {
  audio.play('click');
  start({ mode: game.mode, level: game.level, human: game.mode === 'ai' && choice.side === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : game.human });
};
$('btn-review').onclick = () => ($('over').hidden = true);
$('btn-menu').onclick = () => (audio.play('click'), openMenu());
$('btn-undo').onclick = undo;
$('log-head').onclick = () => {
  $('log').classList.toggle('closed');
  saveSettings();
};
if (settings.logClosed) $('log').classList.add('closed');
$('btn-flip').onclick = () => (audio.play('click'), turnCamera(VIEW.yaw + Math.PI));
const paintToggles = () => {
  $('btn-sound').classList.toggle('off', !audio.settings.sfx);
  $('btn-music').classList.toggle('off', !audio.settings.music);
  $('btn-cine').classList.toggle('off', !settings.cine);
};
$('btn-sound').onclick = () => (audio.toggle('sfx'), paintToggles());
$('btn-music').onclick = () => (audio.toggle('music'), paintToggles());
$('btn-cine').onclick = () => {
  settings.cine = !settings.cine;
  if (!settings.cine) director.release();
  saveSettings();
  paintToggles();
};
paintToggles();
addEventListener('keydown', (e) => {
  // a held Esc is how the player leaves fullscreen on the embedding page; only the first press counts
  if (e.repeat) return;
  if (e.key === 'Escape') {
    if (!$('promo').hidden) return;
    if (!$('menu').hidden && game) $('menu').hidden = true;
    else if (game) openMenu();
  } else if (e.key === 'u' || e.key === 'U' || ((e.ctrlKey || e.metaKey) && e.key === 'z')) undo();
  else if (e.key === 'f' || e.key === 'F') turnCamera(VIEW.yaw + Math.PI);
});

// ---------- pointer ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();
function squareAt(x, y, pieces = true) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const ground = groundSquare();
  // with a piece picked up, the square under the pointer wins over a piece leaning into it from the next square
  if (selected >= 0 && legal.some((m) => m.to === ground || m.ep === ground)) return ground;
  if (pieces) {
    // a click on a piece's body counts for its square, even where the body overlaps the square behind
    let best = null;
    for (const [sq, p] of stage.bySq) {
      const hit = raycaster.intersectObject(p.root, true)[0];
      if (hit && (!best || hit.distance < best.distance)) best = { distance: hit.distance, sq };
    }
    if (best) return best.sq;
  }
  return ground;
}
function groundSquare() {
  if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return -1;
  const f = Math.floor(hitPoint.x + 4), r = Math.floor(4 - hitPoint.z);
  return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f;
}
const canvas = renderer.domElement;
const fingers = new Map();
const drag = { moved: false, x: 0, y: 0 };
let pinch = null;
const spread = () => {
  const [a, b] = fingers.values();
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
};
canvas.addEventListener('pointerdown', (e) => {
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  if (fingers.size === 2) {
    pinch = { spread: spread(), zoom: VIEW.zoom };
    drag.moved = true;
  } else Object.assign(drag, { moved: false, x: e.clientX, y: e.clientY });
});
const lift = (e) => {
  fingers.delete(e.pointerId);
  if (fingers.size < 2) pinch = null;
};
canvas.addEventListener('pointerup', (e) => {
  const tap = fingers.size === 1 && !drag.moved;
  lift(e);
  if (tap) onSquare(squareAt(e.clientX, e.clientY));
});
canvas.addEventListener('pointercancel', lift);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  VIEW.zoom = THREE.MathUtils.clamp(VIEW.zoom * Math.exp(e.deltaY * 0.001), ...ZOOM);
}, { passive: false });
canvas.addEventListener('pointermove', (e) => {
  if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch) {
    VIEW.zoom = THREE.MathUtils.clamp((pinch.zoom * pinch.spread) / spread(), ...ZOOM);
    return;
  }
  if (fingers.size === 1) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    // small jitter while clicking shouldn't turn a click into a drag
    if (!drag.moved && Math.hypot(dx, dy) < 7) return;
    drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    yawGoal = null;
    attract = false;
    VIEW.yaw -= dx * 0.006;
    VIEW.pitch = THREE.MathUtils.clamp(VIEW.pitch + dy * 0.004, ...PITCH);
    return;
  }
  if (e.pointerType === 'mouse') {
    const sq = humanTurn() ? squareAt(e.clientX, e.clientY, false) : -1;
    const p = sq >= 0 ? chess.board[sq] : null;
    const useful = sq >= 0 && ((p && colorOf(p) === chess.turn) || legal.some((m) => m.to === sq || m.ep === sq));
    const next = useful ? sq : -1;
    canvas.style.cursor = useful ? 'pointer' : '';
    if (next !== hoverSq) {
      hoverSq = next;
      refreshMarkers();
    }
  }
});
// iOS Safari ignores user-scalable=no; without this a pinch that starts on the HUD zooms the page around the game
addEventListener('gesturestart', (e) => e.preventDefault());

// ---------- loop ----------
const pipeline = new THREE.RenderPipeline(renderer);
pipeline.outputNode = toonOutlinePass(scene, camera, new THREE.Color('#2b4552'), 0.0028, 1);

stage.reset(chess.board);
fx.warm(new THREE.Vector3(0, 0.5, 2));
setTimeout(() => game || openMenu(), 500);
if (import.meta.env.DEV) Object.assign(window, { stage, chess: () => chess, camera, VIEW, fx, start, commit });

const pushers = [];
const timer = new THREE.Timer();
let pulse = 0;
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.1);
  if (yawGoal !== null) {
    VIEW.yaw += (yawGoal - VIEW.yaw) * (1 - Math.exp(-dt * 4.5));
    if (Math.abs(yawGoal - VIEW.yaw) < 0.002) yawGoal = null;
  }
  stage.update(dt);
  fx.update(dt);
  world.update(dt, Math.cos(VIEW.yaw) >= 0);
  updateCamera(dt);
  pushers.length = 0;
  for (const p of stage.pieces()) if (p.root.position.y < 0.2) pushers.push([p.root.position.x, p.root.position.z, p.pushRadius * p.root.scale.x, 1]);
  world.setPushers(pushers);
  pulse += dt;
  for (const m of markPool) {
    if (!m.visible) continue;
    if (m.userData.kind === MARK.move) m.position.y = 0.08 + Math.sin(pulse * 3 + m.position.x) * 0.012;
    if (m.userData.kind === MARK.check || m.userData.kind === MARK.select) m.material.opacity = 0.65 + Math.sin(pulse * 5) * 0.35;
  }
  pipeline.render();
  const loading = $('loading');
  if (!loading.classList.contains('done')) loading.classList.add('done');
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
