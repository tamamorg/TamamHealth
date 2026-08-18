import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx$/.test(p)) files.push(p);
  }
})('src');

const out = new Map();
const add = (s, f) => {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length < 2) return;
  if (!/[A-Za-z]{2}/.test(t)) return;
  if (/^[{}()<>/\\|&;:=+*#$%^~`]+$/.test(t)) return;
  if (!out.has(t)) out.set(t, f);
};

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  // JSX text nodes: >text<   (no braces/tags inside)
  for (const m of src.matchAll(/>([^<>{}]+)</g)) add(m[1], f);
  // Attributes that render as copy
  for (const m of src.matchAll(/\b(alt|title|aria-label|placeholder|label)=["']([^"']+)["']/g)) add(m[2], f);
}
console.log(JSON.stringify([...out].map(([s, f]) => ({ s, f })), null, 0));
