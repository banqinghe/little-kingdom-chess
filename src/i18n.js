// English is the text in the code; the other languages translate it, keyed by the English. ?lang= wins on load, then
// the player's last pick, then English; never the browser's language.
import zh from './lang/zh.js';
import ja from './lang/ja.js';
import pt from './lang/pt.js';
import es from './lang/es.js';
import ru from './lang/ru.js';

// each language's name in itself, shown on the switch
export const LANGS = { en: 'English', zh: '\u4e2d\u6587', ja: '\u65e5\u672c\u8a9e', pt: 'Portugu\u00eas', es: 'Espa\u00f1ol', ru: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439' };
const DICT = { zh, ja, pt, es, ru };
const KEY = 'little-kingdom-chess.lang';
const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v) => { try { localStorage.setItem(KEY, v); } catch {} },
};
const pick = (q) => { const l = (q ?? '').toLowerCase().slice(0, 2); return l in LANGS ? l : null; };
const q = new URLSearchParams(location.search).get('lang');
export let lang = q ? pick(q) ?? 'en' : pick(store.get()) ?? 'en';

// t('{0} wins!', name): {0}, {1}… are filled in after translating
export function t(en, ...vars) {
  const s = DICT[lang]?.[en] ?? en;
  return vars.length ? s.replace(/\{(\d)\}/g, (_, i) => vars[i]) : s;
}

function applyStatic() {
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : lang;
  for (const el of document.querySelectorAll('[data-t]')) {
    el.dataset.en ??= el.textContent;
    el.textContent = t(el.dataset.en);
  }
  for (const el of document.querySelectorAll('[data-t-title]')) {
    el.dataset.enTitle ??= el.title;
    el.title = t(el.dataset.enTitle);
  }
  document.title = t('Little Kingdom Chess');
}
applyStatic();

const listeners = [];
export const onLang = (f) => listeners.push(f);
export function setLang(l) {
  lang = l;
  store.set(l);
  applyStatic();
  for (const f of listeners) f(l);
}
