#!/usr/bin/env node
// i18n catalogue checker (Node 18+, no dependencies).
//   node web/i18n/check.mjs [--lang ja,de] [--allow-missing] [--quiet]
// Reports, per language: keys missing / extra, placeholder ({name}) and HTML-tag mismatches against en.json;
// and for en.json: keys that no source file uses. Plural keys are families (base.one / base.other ...): a language
// needs the categories its own Intl.PluralRules uses (ja: other; en/es/de: one, other; fr/pt-BR: one, many, other; ...).
// Exit status 1 when anything is wrong (missing keys do not count with --allow-missing, e.g. while a translation is in progress).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(DIR, '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const CODES = ['ja', 'es', 'pt-BR', 'fr', 'de', 'zh-CN'];
const langs = opt('lang') ? opt('lang').split(',') : CODES.filter((c) => fs.existsSync(path.join(DIR, c + '.json')));

const load = (c) => { const d = JSON.parse(fs.readFileSync(path.join(DIR, c + '.json'), 'utf8')); for (const k of Object.keys(d)) if (k.startsWith('_')) delete d[k]; return d; };
const en = load('en');
const CATS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const split = (k) => { const m = /^(.*)\.(zero|one|two|few|many|other)$/.exec(k); return m ? { base: m[1], cat: m[2] } : null; };
// plural bases of the English catalogue
// a family is base.one + base.other with a {n} in them (a key that merely ends in .one, like a button called "One", is not)
const enBases = new Set(Object.keys(en).map(split).filter((x) => x && x.cat === 'other' && ('' + en[x.base + '.one']).includes('{n}') && en[x.base + '.other'].includes('{n}')).map((x) => x.base));
const need = (code) => {
  const cats = new Set(new Intl.PluralRules(code).resolvedOptions().pluralCategories);
  const keys = new Set();
  for (const k of Object.keys(en)) {
    const s = split(k);
    if (s && enBases.has(s.base)) { if (cats.has(s.cat) || s.cat === 'other') keys.add(k); else keys.add(s.base + '.' + [...cats][0]); }
    else keys.add(k);
  }
  // the family keys for this language's own categories
  for (const b of enBases) for (const c of cats) keys.add(b + '.' + c);
  for (const k of [...keys]) { const s = split(k); if (s && enBases.has(s.base) && !cats.has(s.cat) && s.cat !== 'other') keys.delete(k); }
  return keys;
};
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const tags = (s) => [...String(s).matchAll(/<\/?\w+/g)].map((m) => m[0]).sort().join(',');
const enFor = (k) => { if (k in en) return en[k]; const s = split(k); return s && enBases.has(s.base) ? en[s.base + '.other'] ?? en[s.base + '.one'] : undefined; };

let problems = 0;
const say = (...a) => { if (!flag('quiet')) console.log(...a); };

for (const code of langs) {
  const d = load(code);
  const want = need(code);
  const missing = [...want].filter((k) => !(k in d) || d[k] === '');
  const extra = Object.keys(d).filter((k) => !want.has(k));
  const bad = [];
  for (const [k, v] of Object.entries(d)) {
    const src = enFor(k);
    if (src == null) continue;
    const a = vars(src), b = vars(v);
    const oneForm = /\.(one|zero|two)$/.test(k);          // "One minute" without {n} is fine
    if (a !== b && !(oneForm && a.split(',').filter((x) => x !== 'n').join(',') === b.split(',').filter(Boolean).join(','))) bad.push(`${k}: placeholders {${b}} but en has {${a}}`);
    if (tags(src) !== tags(v)) bad.push(`${k}: HTML tags differ from en`);
  }
  console.log(`${code}: ${Object.keys(d).length} keys, ${missing.length} missing, ${extra.length} extra, ${bad.length} placeholder/markup mismatches`);
  if (!flag('quiet')) {
    for (const k of missing.slice(0, 200)) console.log('  missing  ' + k);
    if (missing.length > 200) console.log(`  ... and ${missing.length - 200} more missing`);
    for (const k of extra) console.log('  extra    ' + k);
    for (const m of bad) console.log('  mismatch ' + m);
  }
  problems += extra.length + bad.length + (flag('allow-missing') ? 0 : missing.length);
}

// ---- unused English keys: scan every source file for string literals that look like keys
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (!['i18n', 'downloads', 'models', 'node_modules'].includes(f.name)) walk(p); }
    else if (/\.(js|html|mjs)$/.test(f.name)) files.push(p);
  }
})(WEB);
const lit = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(["'`])([a-z0-9_]+(?:\.[a-z0-9_]+)*\.?)\1/gi)) lit.add(m[2]);
  for (const m of src.matchAll(/data-i18n[\w-]*="([^"]+)"/g)) lit.add(m[1]);
}
const prefixes = [...lit].filter((s) => s.endsWith('.'));        // t('dir.' + x): everything under the prefix counts as used
const unused = Object.keys(en).filter((k) => {
  const s = split(k), key = s && enBases.has(s.base) ? s.base : k;
  return !lit.has(key) && !lit.has(k) && !prefixes.some((p) => key.startsWith(p));
});
console.log(`en: ${Object.keys(en).length} keys, ${unused.length} unused`);
if (!flag('quiet')) for (const k of unused) console.log('  unused   ' + k);
problems += unused.length;

console.log(problems ? `FAILED: ${problems} problem(s)` : 'OK');
process.exit(problems ? 1 : 0);
