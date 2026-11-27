import { colorOf, fileOf, rankOf, typeOf } from './chess.js';

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
// piece-square tables from light's side, rank 8 first (the "simplified evaluation function")
const PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  // the king walks to the centre once the queens and most pieces are gone
  kEnd: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
};
const MATE = 100000;

// score from the side to move's point of view
function evaluate(c) {
  let score = 0, heavy = 0;
  for (const p of c.board) if (p && 'qrbn'.includes(typeOf(p))) heavy += VALUE[typeOf(p)];
  const endgame = heavy <= 1800;
  for (let sq = 0; sq < 64; sq++) {
    const p = c.board[sq];
    if (!p) continue;
    const t = typeOf(p), w = colorOf(p) === 'w';
    const idx = w ? (7 - rankOf(sq)) * 8 + fileOf(sq) : sq;
    const s = VALUE[t] + PST[t === 'k' && endgame ? 'kEnd' : t][idx];
    score += w ? s : -s;
  }
  return c.turn === 'w' ? score : -score;
}

const order = (moves) => moves.sort((a, b) => (b.captured ? VALUE[typeOf(b.captured)] * 10 - VALUE[typeOf(b.piece)] : 0) + (b.promo ? 800 : 0) - ((a.captured ? VALUE[typeOf(a.captured)] * 10 - VALUE[typeOf(a.piece)] : 0) + (a.promo ? 800 : 0)));

class Timeout extends Error {}

export function search(c, { depth: maxDepth = 3, ms = 1000, noise = 0 } = {}) {
  const deadline = performance.now() + ms;
  const base = c.stack.length;
  let nodes = 0;

  function quiesce(alpha, beta) {
    if ((++nodes & 1023) === 0 && performance.now() > deadline) throw new Timeout();
    const stand = evaluate(c);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    for (const m of order(c.moves(true))) {
      c.make(m);
      const s = -quiesce(-beta, -alpha);
      c.unmake();
      if (s >= beta) return beta;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }

  function negamax(depth, alpha, beta, ply) {
    if ((++nodes & 1023) === 0 && performance.now() > deadline) throw new Timeout();
    if (ply > 0 && (c.half >= 100 || c.repetitions() >= 2)) return 0;
    const moves = c.moves();
    if (!moves.length) return c.inCheck() ? -MATE + ply : 0;
    if (depth === 0) return quiesce(alpha, beta);
    for (const m of order(moves)) {
      c.make(m);
      const s = -negamax(depth - 1, -beta, -alpha, ply + 1);
      c.unmake();
      if (s >= beta) return beta;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }

  let root = order(c.moves());
  let best = root[0];
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      // moves within 2 * noise of the best get exact scores, so the noise can reorder them
      let top = -MATE;
      const scored = root.map((m) => {
        c.make(m);
        const s = -negamax(depth - 1, -MATE, -(top - 2 * noise), 1) + (Math.random() - 0.5) * 2 * noise;
        c.unmake();
        top = Math.max(top, s);
        return { m, s };
      });
      scored.sort((a, b) => b.s - a.s);
      root = scored.map((x) => x.m);
      best = root[0];
      if (scored[0].s > MATE - 100) break;
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      // a timed-out search leaves the board mid-line
      while (c.stack.length > base) c.unmake();
      break;
    }
  }
  return best;
}
