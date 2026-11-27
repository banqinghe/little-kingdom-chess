// All sound is synthesized with Web Audio: no audio files to load or license.
const STORE = 'little-kingdom-chess.audio';

// each sound is a list of voices: [wave, startHz, endHz, start, duration, gain]; 'noise' plays filtered noise at startHz
const SOUNDS = {
  select: [['triangle', 880, 990, 0, 0.08, 0.16], ['sine', 1320, 1320, 0.03, 0.1, 0.08]],
  deselect: [['triangle', 700, 560, 0, 0.08, 0.12]],
  step: [['noise', 900, 500, 0, 0.05, 0.14], ['sine', 140, 90, 0, 0.05, 0.12]],
  hoof: [['sine', 260, 170, 0, 0.06, 0.3], ['noise', 2200, 1400, 0, 0.03, 0.12]],
  rumble: [['noise', 260, 180, 0, 0.18, 0.18], ['sine', 70, 60, 0, 0.18, 0.18]],
  land: [['sine', 160, 70, 0, 0.16, 0.4], ['noise', 700, 200, 0, 0.12, 0.18]],
  whoosh: [['noise', 900, 3200, 0, 0.16, 0.28]],
  clang: [['triangle', 1568, 1500, 0, 0.25, 0.16], ['triangle', 2093, 2000, 0, 0.2, 0.1], ['noise', 4000, 2500, 0, 0.06, 0.15]],
  thud: [['sine', 150, 55, 0, 0.25, 0.55], ['noise', 500, 150, 0, 0.18, 0.3]],
  magic: [1047, 1319, 1568, 2093].map((f, i) => ['sine', f, f * 1.01, i * 0.05, 0.25, 0.12]),
  zap: [['triangle', 600, 1800, 0, 0.18, 0.16], ['noise', 3000, 6000, 0, 0.15, 0.1]],
  poof: [['noise', 3000, 800, 0, 0.3, 0.16], ['sine', 1568, 2349, 0.05, 0.25, 0.1], ['sine', 2093, 3136, 0.12, 0.3, 0.07]],
  charge: [['sawtooth', 110, 220, 0, 0.35, 0.08], ['noise', 300, 900, 0, 0.35, 0.2]],
  neigh: [['sawtooth', 700, 1000, 0, 0.12, 0.06], ['sawtooth', 1000, 600, 0.12, 0.35, 0.07]],
  check: [['triangle', 988, 988, 0, 0.18, 0.2], ['triangle', 784, 784, 0.16, 0.3, 0.2]],
  promote: [523, 659, 784, 1047, 1319].map((f, i) => ['triangle', f, f, i * 0.07, 0.3, 0.16]),
  castle: [['triangle', 392, 392, 0, 0.15, 0.18], ['triangle', 523, 523, 0.12, 0.25, 0.18]],
  win: [523, 659, 784, 1047, 784, 1047, 1319].map((f, i) => ['triangle', f, f, i * 0.13, i === 6 ? 0.9 : 0.16, 0.22]),
  lose: [523, 494, 440, 349].map((f, i) => ['triangle', f, f * (i === 3 ? 0.95 : 1), i * 0.28, i === 3 ? 1 : 0.28, 0.2]),
  draw: [['triangle', 523, 523, 0, 0.3, 0.18], ['triangle', 659, 659, 0.25, 0.5, 0.16]],
  click: [['triangle', 660, 660, 0, 0.05, 0.14]],
};
const MIN_GAP = { step: 0.06, hoof: 0.05, rumble: 0.12 };

// a music box over soft pads: I–vi–IV–V in F, a lilting 3/4
const BPM = 92;
const CHORDS = [[53, 57, 60], [50, 53, 57], [46, 50, 53], [48, 52, 55]];
const MELODY = [72, 0, 69, 70, 72, 0, 74, 72, 69, 0, 67, 65, 70, 0, 69, 67, 65, 0, 67, 69, 72, 0, 67, 0];
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

export function createAudio() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORE)) ?? {};
  } catch {}
  const settings = { sfx: saved.sfx ?? true, music: saved.music ?? true };
  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(settings));
    } catch {}
  };

  let ctx = null;
  let sfxBus, musicBus, noise;
  const last = {};

  function init() {
    if (ctx) return ctx.state === 'suspended' && ctx.resume();
    ctx = new AudioContext();
    const master = ctx.createDynamicsCompressor();
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    musicBus = ctx.createGain();
    sfxBus.gain.value = settings.sfx ? 0.6 : 0;
    musicBus.gain.value = settings.music ? 0.2 : 0;
    sfxBus.connect(master);
    musicBus.connect(master);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startMusic();
  }
  // browsers only allow audio after a user gesture
  addEventListener('pointerdown', init);
  addEventListener('keydown', init);

  function voice(bus, [wave, f0, f1, at, dur, gain], t0, attack = 0.005) {
    const t = t0 + at;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    env.connect(bus);
    let src;
    if (wave === 'noise') {
      src = ctx.createBufferSource();
      src.buffer = noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.2;
      filter.frequency.setValueAtTime(f0, t);
      filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
      src.connect(filter).connect(env);
    } else {
      src = ctx.createOscillator();
      src.type = wave;
      src.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) src.frequency.exponentialRampToValueAtTime(f1, t + dur);
      src.connect(env);
    }
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function play(name, delay = 0) {
    if (!ctx || !settings.sfx || !SOUNDS[name]) return;
    const now = ctx.currentTime + delay;
    if (now - (last[name] ?? -1) < (MIN_GAP[name] ?? 0)) return;
    last[name] = now;
    for (const v of SOUNDS[name]) voice(sfxBus, v, now);
  }

  function chirp(t) {
    // a little bird: two or three quick upward whistles
    const base = 2600 + Math.random() * 1200;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) voice(musicBus, ['sine', base, base * 1.35, i * 0.11, 0.08, 0.05], t);
  }

  let step = 0;
  let nextAt = 0;
  let birdAt = 0;
  function startMusic() {
    nextAt = ctx.currentTime + 0.2;
    birdAt = ctx.currentTime + 3;
    // lookahead scheduler: queue notes slightly ahead so timer jitter never causes gaps
    setInterval(() => {
      while (nextAt < ctx.currentTime + 0.25) {
        const beat = step % 3;
        const bar = Math.floor(step / 3);
        const chord = CHORDS[bar % CHORDS.length];
        if (beat === 0) {
          for (const n of chord) voice(musicBus, ['sine', midi(n), midi(n), 0, 2.2, 0.07], nextAt, 0.25);
          voice(musicBus, ['sine', midi(chord[0] - 12), midi(chord[0] - 12), 0, 1.8, 0.16], nextAt, 0.02);
        }
        const note = MELODY[step % MELODY.length];
        if (note && (bar % 8) < 6) {
          voice(musicBus, ['sine', midi(note), midi(note), 0, 0.9, 0.12], nextAt);
          voice(musicBus, ['triangle', midi(note + 12), midi(note + 12), 0, 0.25, 0.03], nextAt);
        }
        nextAt += 60 / BPM;
        step++;
      }
      if (ctx.currentTime > birdAt) {
        chirp(ctx.currentTime + 0.05);
        birdAt = ctx.currentTime + 6 + Math.random() * 10;
      }
    }, 60);
  }

  function toggle(kind) {
    settings[kind] = !settings[kind];
    save();
    if (ctx) (kind === 'sfx' ? sfxBus : musicBus).gain.value = settings[kind] ? (kind === 'sfx' ? 0.6 : 0.2) : 0;
    return settings[kind];
  }

  return { play, toggle, settings };
}
