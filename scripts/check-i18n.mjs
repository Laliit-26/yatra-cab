// Verifies the message catalogues: key parity between locales, matching
// {placeholders}, and that every t('...') call site resolves to a real key.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const msgDir = path.join(root, 'apps/design-system/src/i18n/messages');

const load = (l) => JSON.parse(fs.readFileSync(path.join(msgDir, `${l}.json`), 'utf8'));
const flat = (o, p = '') =>
  Object.entries(o).reduce((acc, [k, v]) => {
    const key = p ? `${p}.${k}` : k;
    return Object.assign(acc, v && typeof v === 'object' ? flat(v, key) : { [key]: v });
  }, {});

const en = flat(load('en'));
const hi = flat(load('hi'));
const problems = [];

for (const k of Object.keys(en)) if (!(k in hi)) problems.push(`missing in hi: ${k}`);
for (const k of Object.keys(hi)) if (!(k in en)) problems.push(`missing in en: ${k}`);

const vars = (s = '') => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
for (const k of Object.keys(en)) {
  if (k in hi && vars(en[k]) !== vars(hi[k])) problems.push(`placeholder mismatch: ${k}`);
}

// Walk the source for `useTranslations('Ns')` + `t('key')` pairs.
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    // Skip the i18n runtime itself: its doc comments contain example t() calls.
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'i18n' || e.name.startsWith('.')) continue;
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(e.name)) out.push(full);
  }
  return out;
};

let checked = 0;
for (const file of walk(path.join(root, 'apps'))) {
  const src = fs.readFileSync(file, 'utf8');
  // Namespace per variable name: const t = useTranslations('Book')
  const ns = {};
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*useTranslations\(\s*'([^']+)'\s*\)/g)) ns[m[1]] = m[2];
  if (!Object.keys(ns).length) continue;
  for (const m of src.matchAll(/\b(\w+)\(\s*'([^']+)'/g)) {
    const [, fn, key] = m;
    if (!(fn in ns)) continue;
    checked += 1;
    const full = `${ns[fn]}.${key}`;
    if (!(full in en)) problems.push(`${path.relative(root, file)} → unknown key ${full}`);
  }
}

// A component that calls t() without useTranslations in scope compiles fine
// and then throws "t is not defined" at runtime — the build cannot catch it.
let scopes = 0;
for (const file of walk(path.join(root, 'apps'))) {
  const src = fs.readFileSync(file, 'utf8');
  const fns = [...src.matchAll(/^(?:export\s+)?(?:default\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/gm)];
  for (let i = 0; i < fns.length; i += 1) {
    const start = fns[i].index + fns[i][0].length;
    const body = src.slice(start, fns[i + 1] ? fns[i + 1].index : src.length);
    if (!/\bt\('/.test(body)) continue;
    scopes += 1;
    if (!/useTranslations\(/.test(body)) {
      problems.push(`${path.relative(root, file)} → ${fns[i][1]}() calls t() with no useTranslations in scope`);
    }
  }
}

console.log(`en ${Object.keys(en).length} keys · hi ${Object.keys(hi).length} keys · ${checked} call sites · ${scopes} components checked`);
if (problems.length) {
  console.error('\nProblems:');
  problems.forEach((p) => console.error('  ✗ ' + p));
  process.exit(1);
}
console.log('i18n OK ✓');
