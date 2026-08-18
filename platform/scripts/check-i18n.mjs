#!/usr/bin/env node
/**
 * Locale parity check.
 *
 * en.ts is the source of truth. Every other locale under src/lib/i18n/locales
 * must define the same key set, with the same {{placeholders}} in each value.
 *
 * Without this, a missing key silently falls back to English (loadTranslations
 * merges over the en base) and a dropped {{placeholder}} silently renders a
 * sentence with a hole in it — both invisible until someone runs the app in
 * that language. Run via `npm run i18n:check`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'i18n', 'locales');
const ENTRY = /^\s*'((?:[^'\\]|\\.)*)':\s*'((?:[^'\\]|\\.)*)',?\s*$/gm;

function parse(file) {
  const src = readFileSync(join(LOCALES_DIR, file), 'utf8');
  const out = new Map();
  let m;
  ENTRY.lastIndex = 0;
  while ((m = ENTRY.exec(src))) out.set(m[1], m[2]);
  return out;
}

const placeholders = (value) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');

const en = parse('en.ts');
const others = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.ts') && f !== 'en.ts');

let failures = 0;
const report = (msg) => { console.error(msg); failures++; };

console.log(`en.ts: ${en.size} keys`);

for (const file of others) {
  const locale = parse(file);
  const missing = [...en.keys()].filter((k) => !locale.has(k));
  const extra = [...locale.keys()].filter((k) => !en.has(k));
  const drift = [...en].filter(([k, v]) => locale.has(k) && placeholders(v) !== placeholders(locale.get(k)));

  console.log(`${file}: ${locale.size} keys`);
  for (const k of missing.slice(0, 20)) report(`  MISSING  ${file} ${k}`);
  if (missing.length > 20) report(`  MISSING  ${file} …and ${missing.length - 20} more`);
  for (const k of extra.slice(0, 20)) report(`  ORPHAN   ${file} ${k} (not in en.ts)`);
  if (extra.length > 20) report(`  ORPHAN   ${file} …and ${extra.length - 20} more`);
  for (const [k, v] of drift.slice(0, 20)) {
    report(`  PLACEHOLDER ${file} ${k} — en has {{${placeholders(v) || '—'}}}, locale has {{${placeholders(locale.get(k)) || '—'}}}`);
  }
  if (drift.length > 20) report(`  PLACEHOLDER ${file} …and ${drift.length - 20} more`);
}

if (failures) {
  console.error(`\ni18n check failed with ${failures} problem(s).`);
  process.exit(1);
}
console.log('\ni18n check passed — every locale covers en.ts with matching placeholders.');
