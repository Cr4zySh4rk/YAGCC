// Internationalisation: t(key, vars), setLang/getLang, a `langchange` event and applyI18n(root) for static markup.
// Language files are plain JSON at web/i18n/<code>.json (flat "namespace.key": "text"). English is the source and the
// fallback. See web/i18n/README.md for key naming, placeholders, plurals and how to add a language.
//
//   t('setup.tilt.title')                      -> "Tilt switch"
//   t('nav.clear', { name: 'Green' })          -> "Clear Green"             ({name} placeholders)
//   t('lights.led_count', { n: 3 })            -> "3 LEDs"                  (keys lights.led_count.one / .other)
//   <h2 data-i18n="tune.title">Tune</h2>       -> textContent
//   data-i18n-html / -title / -placeholder / -aria-label / -alt / -content
//
// Top-level await: every module that imports this file starts after English and the chosen language are loaded, so
// module-level t() calls (tables of labels) already see the right strings. Those tables are wrapped in localized() so they
// are rebuilt in place when the language changes.

const V = '?v=dev';                                  // cache-busting suffix, rewritten at deploy like the other assets
export const LANGS = [
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'es', name: 'Español' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'ru', name: 'Русский' },
  { code: 'ko', name: '한국어' },
];
export const PSEUDO = 'xx';                          // ?lang=xx: bracketed, accented, ~35 % longer (finds hard-coded English)
const STORE_KEY = 'yagcc.lang';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let lang = 'en';
const dicts = {};                                   // code -> { key: text }
let rules = null;                                   // Intl.PluralRules for the current language
const refreshers = [];                              // localized() tables

const known = (code) => LANGS.some((l) => l.code === code);

// "ja-JP" -> "ja", "pt" -> "pt-BR", "zh-Hans-CN" -> "zh-CN"; Traditional Chinese is not offered (null)
export function matchLang(tag) {
  const s = String(tag || '').toLowerCase();
  if (!s) return null;
  if (s.startsWith('zh')) return /hant|-tw|-hk|-mo/.test(s) ? null : 'zh-CN';
  const base = s.split('-')[0];
  if (base === 'pt') return 'pt-BR';
  return ['en', 'ja', 'es', 'fr', 'de', 'ru', 'ko'].includes(base) ? base : null;
}

export function detectLang() {
  let q = '';
  try { q = new URLSearchParams(location.search).get('lang') || ''; } catch { /* no location */ }
  if (q === PSEUDO) return PSEUDO;
  const fromQuery = known(q) ? q : matchLang(q);
  if (fromQuery) return fromQuery;
  const saved = store.get(STORE_KEY);
  if (saved && known(saved)) return saved;
  const nav = typeof navigator !== 'undefined' ? navigator : {};   // Node 20 (the CI tests) has no navigator
  for (const tag of (nav.languages && nav.languages.length ? nav.languages : [nav.language])) {
    const m = matchLang(tag);
    if (m) return m;
  }
  return 'en';
}

async function load(code) {
  if (code === PSEUDO) code = 'en';
  if (dicts[code]) return dicts[code];
  try {
    const url = new URL('../i18n/' + code + '.json' + V, import.meta.url);
    if (typeof document === 'undefined' && url.protocol === 'file:') {            // Node (unit tests): no fetch for file: URLs
      const fs = await import('node:fs/promises');
      dicts[code] = JSON.parse(await fs.readFile(new URL('../i18n/' + code + '.json', import.meta.url), 'utf8'));
    } else {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      dicts[code] = await r.json();
    }
  } catch (e) {
    console.warn('i18n: could not load ' + code, e);
    dicts[code] = {};
  }
  return dicts[code];
}

export const getLang = () => lang;
export const isPseudo = () => lang === PSEUDO;

// ---- pseudo-locale: [Ŝéţûþ ~~~] keeps {placeholders}, <tags> and &entities; untranslated text stays visibly plain
const ACCENT = { a: 'à', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ', n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Â', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ', N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž' };
export function pseudo(s) {
  let visible = 0;
  const body = s.split(/(<[^>]*>|&#?\w+;|\{\w+\})/).map((part, i) => {
    if (i % 2) return part;
    visible += part.length;
    return part.replace(/[A-Za-z]/g, (c) => ACCENT[c]);
  }).join('');
  const pad = Math.max(1, Math.ceil(visible * 0.35));
  let tail = '';
  for (let n = 0; n < pad; n += 3) tail += ' ' + '~'.repeat(Math.min(3, pad - n));
  return '[' + body + tail + ']';
}

function lookup(key) {
  const d = dicts[lang === PSEUDO ? 'en' : lang];
  if (d && d[key] != null) return d[key];
  const en = dicts.en;
  return en && en[key] != null ? en[key] : null;
}

export function t(key, vars) {
  let s = null;
  if (vars && typeof vars.n === 'number') {
    const cat = rules ? rules.select(vars.n) : 'other';
    s = lookup(key + '.' + cat);
    if (s == null && cat !== 'other') s = lookup(key + '.other');
    if (s == null) s = lookup(key);
  } else s = lookup(key);
  if (s == null) return key;
  if (lang === PSEUDO) s = pseudo(s);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars && vars[k] != null ? String(vars[k]) : m));
  return s;
}
export const hasKey = (key) => lookup(key) != null;

// ---- static markup
const ATTR_MAP = [['data-i18n-title', 'title'], ['data-i18n-placeholder', 'placeholder'], ['data-i18n-aria-label', 'aria-label'], ['data-i18n-alt', 'alt'], ['data-i18n-content', 'content']];
export function applyI18n(root = document) {
  const scope = root.querySelectorAll ? root : document;
  const each = (sel, fn) => { if (root.matches && root !== document && root.matches(sel)) fn(root); scope.querySelectorAll(sel).forEach(fn); };
  each('[data-i18n]', (el) => { el.textContent = t(el.getAttribute('data-i18n')); });
  each('[data-i18n-html]', (el) => { el.innerHTML = t(el.getAttribute('data-i18n-html')); });   // only our own, trusted strings
  for (const [data, attr] of ATTR_MAP) each('[' + data + ']', (el) => el.setAttribute(attr, t(el.getAttribute(data))));
  if (root === document) { document.documentElement.lang = lang === PSEUDO ? 'en' : lang; }
}

// ---- tables that hold translated labels: localized(() => [...]) returns the table and rebuilds it in place on a language change
export function localized(factory) {
  const v = factory();
  if (v && typeof v === 'object') {
    refreshers.push(() => {
      const nv = factory();
      if (Array.isArray(v)) { v.length = 0; v.push(...nv); } else { for (const k of Object.keys(v)) delete v[k]; Object.assign(v, nv); }
    });
  }
  return v;
}

export async function setLang(code, { persist = true } = {}) {
  if (code !== PSEUDO && !known(code)) code = matchLang(code) || 'en';
  await load('en');
  await load(code);
  lang = code;
  try { rules = new Intl.PluralRules(code === PSEUDO ? 'en' : code); } catch { rules = null; }
  if (persist && code !== PSEUDO) store.set(STORE_KEY, code);
  refreshers.forEach((f) => f());
  if (typeof document !== 'undefined') {
    applyI18n(document);
    document.dispatchEvent(new CustomEvent('langchange', { bubbles: true, detail: { lang: code } }));
  }
  return code;
}
export const onLangChange = (fn) => document.addEventListener('langchange', (e) => fn(e.detail.lang));

// initial language: before any other module runs
await setLang(detectLang(), { persist: false });
