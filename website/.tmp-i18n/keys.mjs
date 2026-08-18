import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as data from '../src/lib/site-data.ts';

// 1. every literal passed to t(" … ")
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
})('src');

const keys = new Set();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\("((?:[^"\\]|\\.)*)"\)/g)) {
    keys.add(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim());
  }
}
const fromCode = keys.size;

// 2. every translatable string reachable from site-data, using the same
//    opaque-key rules as translateDeep
const OPAQUE = new Set(['slug','href','src','image','accent','color','dateISO','id','key','icon','value','code','email','phone','url','name_en','focus','lifecycle','idPlaceholder','WEB3FORMS_ACCESS_KEY','d','d2','d3']);
function walkData(v, key) {
  if (typeof v === 'string') {
    if (OPAQUE.has(key)) return;
    const t = v.trim();
    if (!t) return;
    if (/^[#/]/.test(t) || /^https?:/.test(t)) return;
    if (/^[\d\s.,%$+-]+$/.test(t)) return;
    keys.add(t);
    return;
  }
  if (Array.isArray(v)) return v.forEach((x) => walkData(x, key));
  if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) walkData(val, k);
}
for (const [name, value] of Object.entries(data)) {
  if (typeof value === 'function') continue;
  walkData(value, name);
}

const all = [...keys].sort((a, b) => a.localeCompare(b));
writeFileSync('.tmp-i18n/keys.json', JSON.stringify(all, null, 0));
console.error(`t() literals: ${fromCode} | total keys: ${all.length} | words: ${all.join(' ').split(/\s+/).length}`);
