// Chess rules. Squares are 0..63, a1 = 0, h1 = 7, a8 = 56. Pieces are FEN letters: uppercase light, lowercase dark.
export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const BISHOP = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
// castling rights lost when a piece leaves or lands on these squares
const RIGHTS = { 0: 'Q', 7: 'K', 4: 'KQ', 56: 'q', 63: 'k', 60: 'kq' };

export const colorOf = (p) => (p === p.toUpperCase() ? 'w' : 'b');
export const typeOf = (p) => p.toLowerCase();
export const fileOf = (sq) => sq & 7;
export const rankOf = (sq) => sq >> 3;
export const sqName = (sq) => 'abcdefgh'[sq & 7] + ((sq >> 3) + 1);
// a move as a short string for storage and the AI worker: 'from,to[,promo]'
export const moveKey = (m) => m.from + ',' + m.to + (m.promo ? ',' + m.promo.toLowerCase() : '');
const at = (f, r) => (f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f);

export class Chess {
  constructor(fen = START) {
    this.load(fen);
  }

  load(fen) {
    const [rows, turn, castling, ep, half, full] = fen.split(' ');
    this.board = Array(64).fill(null);
    rows.split('/').forEach((row, i) => {
      let f = 0;
      for (const c of row) {
        if (/\d/.test(c)) f += +c;
        else this.board[(7 - i) * 8 + f++] = c;
      }
    });
    this.turn = turn;
    this.castling = castling === '-' ? '' : castling;
    this.ep = ep === '-' ? -1 : 'abcdefgh'.indexOf(ep[0]) + (+ep[1] - 1) * 8;
    this.half = +half || 0;
    this.full = +full || 1;
    this.stack = [];
    this.keys = [this.key()];
  }

  fen() {
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      let s = '', e = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 8 + f];
        if (!p) e++;
        else (s += (e || '') + p), (e = 0);
      }
      rows.push(s + (e || ''));
    }
    return `${rows.join('/')} ${this.turn} ${this.castling || '-'} ${this.ep < 0 ? '-' : sqName(this.ep)} ${this.half} ${this.full}`;
  }

  key() {
    return this.board.map((p) => p || '.').join('') + this.turn + this.castling + this.ep;
  }

  king(color) {
    return this.board.indexOf(color === 'w' ? 'K' : 'k');
  }

  attacked(sq, by) {
    const f = fileOf(sq), r = rankOf(sq), b = this.board;
    const is = (s, t) => s >= 0 && b[s] && colorOf(b[s]) === by && t.includes(typeOf(b[s]));
    const dir = by === 'w' ? -1 : 1;
    if (is(at(f - 1, r + dir), 'p') || is(at(f + 1, r + dir), 'p')) return true;
    for (const [df, dr] of KNIGHT) if (is(at(f + df, r + dr), 'n')) return true;
    for (const [df, dr] of KING) if (is(at(f + df, r + dr), 'k')) return true;
    for (const [dirs, t] of [[ROOK, 'rq'], [BISHOP, 'bq']]) {
      for (const [df, dr] of dirs) {
        for (let i = 1; ; i++) {
          const s = at(f + df * i, r + dr * i);
          if (s < 0) break;
          if (b[s]) {
            if (is(s, t)) return true;
            break;
          }
        }
      }
    }
    return false;
  }

  inCheck(color = this.turn) {
    return this.attacked(this.king(color), color === 'w' ? 'b' : 'w');
  }

  pseudo(capturesOnly = false) {
    const out = [], b = this.board, us = this.turn, them = us === 'w' ? 'b' : 'w';
    const add = (from, to, extra) => {
      const captured = b[to];
      if (capturesOnly && !captured && !extra?.promo && !extra?.ep) return;
      out.push({ from, to, piece: b[from], captured, ...extra });
    };
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p || colorOf(p) !== us) continue;
      const f = fileOf(sq), r = rankOf(sq), t = typeOf(p);
      if (t === 'p') {
        const dir = us === 'w' ? 1 : -1, last = us === 'w' ? 7 : 0, home = us === 'w' ? 1 : 6;
        const pawnTo = (to, extra) => {
          if (rankOf(to) === last) for (const promo of 'qrbn') add(sq, to, { ...extra, promo: us === 'w' ? promo.toUpperCase() : promo });
          else add(sq, to, extra);
        };
        const one = at(f, r + dir);
        if (!b[one]) {
          pawnTo(one);
          const two = at(f, r + 2 * dir);
          if (r === home && !b[two] && !capturesOnly) add(sq, two, { double: true });
        }
        for (const df of [-1, 1]) {
          const to = at(f + df, r + dir);
          if (to < 0) continue;
          if (b[to] && colorOf(b[to]) === them) pawnTo(to);
          else if (to === this.ep) out.push({ from: sq, to, piece: p, captured: b[to - 8 * dir], ep: to - 8 * dir });
        }
        continue;
      }
      const step = (dirs, slide) => {
        for (const [df, dr] of dirs) {
          for (let i = 1; ; i++) {
            const to = at(f + df * i, r + dr * i);
            if (to < 0 || (b[to] && colorOf(b[to]) === us)) break;
            add(sq, to);
            if (b[to] || !slide) break;
          }
        }
      };
      if (t === 'n') step(KNIGHT, false);
      else if (t === 'b') step(BISHOP, true);
      else if (t === 'r') step(ROOK, true);
      else if (t === 'q') step([...ROOK, ...BISHOP], true);
      else {
        step(KING, false);
        if (capturesOnly) continue;
        const [k, q, row] = us === 'w' ? ['K', 'Q', 0] : ['k', 'q', 56];
        if (sq !== row + 4 || this.attacked(sq, them)) continue;
        if (this.castling.includes(k) && !b[row + 5] && !b[row + 6] && !this.attacked(row + 5, them) && !this.attacked(row + 6, them))
          out.push({ from: sq, to: row + 6, piece: p, captured: null, castle: [row + 7, row + 5] });
        if (this.castling.includes(q) && !b[row + 3] && !b[row + 2] && !b[row + 1] && !this.attacked(row + 3, them) && !this.attacked(row + 2, them))
          out.push({ from: sq, to: row + 2, piece: p, captured: null, castle: [row, row + 3] });
      }
    }
    return out;
  }

  moves(capturesOnly = false) {
    const us = this.turn;
    return this.pseudo(capturesOnly).filter((m) => {
      this.make(m);
      const ok = !this.inCheck(us);
      this.unmake();
      return ok;
    });
  }

  make(m) {
    const b = this.board;
    this.stack.push({ m, castling: this.castling, ep: this.ep, half: this.half, full: this.full });
    b[m.to] = m.promo || m.piece;
    b[m.from] = null;
    if (m.ep !== undefined) b[m.ep] = null;
    if (m.castle) {
      b[m.castle[1]] = b[m.castle[0]];
      b[m.castle[0]] = null;
    }
    for (const sq of [m.from, m.to]) if (RIGHTS[sq]) this.castling = this.castling.replace(new RegExp(`[${RIGHTS[sq]}]`, 'g'), '');
    this.ep = m.double ? (m.from + m.to) / 2 : -1;
    this.half = m.captured || typeOf(m.piece) === 'p' ? 0 : this.half + 1;
    if (this.turn === 'b') this.full++;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    this.keys.push(this.key());
  }

  unmake() {
    const { m, castling, ep, half, full } = this.stack.pop();
    const b = this.board;
    this.keys.pop();
    this.turn = this.turn === 'w' ? 'b' : 'w';
    b[m.from] = m.piece;
    b[m.to] = null;
    if (m.ep !== undefined) b[m.ep] = m.captured;
    else b[m.to] = m.captured;
    if (m.castle) {
      b[m.castle[0]] = b[m.castle[1]];
      b[m.castle[1]] = null;
    }
    Object.assign(this, { castling, ep, half, full });
    return m;
  }

  repetitions() {
    const k = this.keys[this.keys.length - 1];
    return this.keys.filter((x) => x === k).length;
  }

  insufficient() {
    const rest = this.board.filter((p) => p && typeOf(p) !== 'k');
    if (rest.length === 0) return true;
    if (rest.length === 1 && 'nb'.includes(typeOf(rest[0]))) return true;
    // only bishops, all on one square colour
    const bishops = this.board.map((p, sq) => (p && typeOf(p) === 'b' ? (fileOf(sq) + rankOf(sq)) & 1 : -1)).filter((c) => c >= 0);
    return rest.every((p) => typeOf(p) === 'b') && new Set(bishops).size === 1;
  }

  // 'checkmate' | 'stalemate' | 'fifty' | 'repetition' | 'material' | null while the game goes on
  result() {
    if (!this.moves().length) return this.inCheck() ? 'checkmate' : 'stalemate';
    if (this.half >= 100) return 'fifty';
    if (this.repetitions() >= 3) return 'repetition';
    if (this.insufficient()) return 'material';
    return null;
  }

  san(m) {
    const t = typeOf(m.piece);
    if (m.castle) return m.to > m.from ? 'O-O' : 'O-O-O';
    let s = '';
    if (t === 'p') s = m.captured ? 'abcdefgh'[fileOf(m.from)] + 'x' : '';
    else {
      s = t.toUpperCase();
      const twins = this.moves().filter((o) => o.to === m.to && o.from !== m.from && o.piece === m.piece);
      if (twins.length) {
        if (twins.every((o) => fileOf(o.from) !== fileOf(m.from))) s += 'abcdefgh'[fileOf(m.from)];
        else if (twins.every((o) => rankOf(o.from) !== rankOf(m.from))) s += rankOf(m.from) + 1;
        else s += sqName(m.from);
      }
      if (m.captured) s += 'x';
    }
    s += sqName(m.to);
    if (m.promo) s += '=' + m.promo.toUpperCase();
    this.make(m);
    if (this.inCheck()) s += this.moves().length ? '+' : '#';
    this.unmake();
    return s;
  }
}
