import * as data from '../src/lib/site-data.ts';

const OPAQUE = new Set(['slug','href','src','image','accent','color','dateISO','id','key','icon','value','code','email','phone','url','name_en']);
const out = new Set();

function walk(v, key) {
  if (typeof v === 'string') {
    if (OPAQUE.has(key)) return;
    const t = v.trim();
    if (!t) return;
    if (/^[#/]/.test(t)) return;                 // colours, paths
    if (/^https?:/.test(t)) return;              // urls
    if (/^[\d\s.,%$+-]+$/.test(t)) return;       // bare numbers
    out.add(t);
    return;
  }
  if (Array.isArray(v)) return v.forEach((x) => walk(x, key));
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) walk(val, k);
  }
}

for (const [name, value] of Object.entries(data)) {
  if (typeof value === 'function') continue;
  walk(value, name);
}
console.log(JSON.stringify([...out], null, 0));
