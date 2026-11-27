import { Chess, moveKey } from './chess.js';
import { search } from './ai.js';

// the search blocks for up to a couple of seconds, so it runs here instead of on the render thread
const LEVELS = [
  { depth: 1, noise: 140 },
  { depth: 3, ms: 900, noise: 30 },
  { depth: 6, ms: 1800 },
];

onmessage = ({ data: { history, level } }) => {
  const c = new Chess();
  for (const key of history) c.make(c.moves().find((m) => moveKey(m) === key));
  postMessage(moveKey(search(c, LEVELS[level])));
};
