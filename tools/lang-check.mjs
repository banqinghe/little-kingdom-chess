// Every English string the game shows (t('…') in src/main.js, data-t / data-t-title in index.html) has a translation
// in every language file, and every translation keeps the {0} placeholders. usage: node tools/lang-check.mjs
import { readFileSync, readdirSync } from 'node:fs';

const js = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const keys = new Set([
  ...[...js.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'")),
  ...[...html.matchAll(/data-t>([^<]+)</g)].map((m) => m[1]),
  ...[...html.matchAll(/title="([^"]+)" data-t-title/g)].map((m) => m[1]),
  'Little Kingdom Chess',
]);
let bad = 0;
for (const f of readdirSync(new URL('../src/lang/', import.meta.url))) {
  const dict = (await import(`../src/lang/${f}`)).default;
  for (const k of keys) {
    const v = dict[k];
    if (v === undefined) { console.log(`${f}: missing ${JSON.stringify(k)}`); bad++; continue; }
    const holes = (s) => (s.match(/\{\d\}/g) ?? []).sort().join();
    if (holes(k) !== holes(v)) { console.log(`${f}: placeholders differ in ${JSON.stringify(k)}`); bad++; }
  }
  for (const k of Object.keys(dict)) if (!keys.has(k)) { console.log(`${f}: unused ${JSON.stringify(k)}`); bad++; }
}
console.log(bad ? `${bad} problems` : `${keys.size} strings, every language complete`);
process.exit(bad ? 1 : 0);
