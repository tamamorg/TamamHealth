#!/usr/bin/env node
/**
 * Reports user-facing copy that has no entry in a locale dictionary.
 *
 * Translation here keys on the English source string (see lib/i18n/index.ts for
 * why), which has one sharp edge: editing a sentence in `site-data.ts` or in a
 * `t("…")` call silently orphans its translation and the page quietly reverts
 * to English. This is the check that makes that visible. It is a report, not a
 * gate — English fallback is a working page, not a broken one — so it exits 0
 * and prints what is missing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = 'src';
const OPAQUE = new Set(['slug','href','src','image','accent','color','dateISO','id','key','icon','code','email','phone','url','name_en','focus','idPlaceholder','WEB3FORMS_ACCESS_KEY','d','d2','d3','menu']);

// lib/i18n is the machinery, not the copy — and scanning it would match the
// `t("…")` written in its own doc comments.
const I18N_DIR = join(SRC, 'lib', 'i18n');
const files = [];
(function walk(dir) {
  if (dir === I18N_DIR) return;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
})(SRC);

const keys = new Set();
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\("((?:[^"\\]|\\.)*)"\s*[,)]/g)) {
    keys.add(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim());
  }
}

const data = await import(pathToFileURL(join(process.cwd(), SRC, 'lib', 'site-data.ts')).href);
function walkData(value, key) {
  if (typeof value === 'string') {
    if (OPAQUE.has(key)) return;
    const t = value.trim();
    if (!t || /^[#/]/.test(t) || /^https?:/.test(t) || /^[\d\s.,%$+-]+$/.test(t)) return;
    keys.add(t);
    return;
  }
  if (Array.isArray(value)) return value.forEach((v) => walkData(v, key));
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walkData(v, k);
  }
}
for (const [name, value] of Object.entries(data)) {
  if (typeof value === 'function') continue;
  walkData(value, name);
}

const { SUPPORTED_LOCALES } = await import(pathToFileURL(join(process.cwd(), SRC, 'lib', 'i18n', 'index.ts')).href);
const all = [...keys];
console.log(`user-facing strings: ${all.length}`);

for (const locale of SUPPORTED_LOCALES.filter((l) => l.code !== 'en')) {
  const mod = await import(pathToFileURL(join(process.cwd(), SRC, 'lib', 'i18n', `${locale.code}.ts`)).href);
  const dict = mod[locale.code] ?? {};
  const missing = all.filter((k) => dict[k] === undefined);
  const orphan = Object.keys(dict).filter((k) => !keys.has(k));
  const pct = Math.round(((all.length - missing.length) / all.length) * 100);
  console.log(`\n${locale.code} (${locale.name}): ${all.length - missing.length}/${all.length} translated (${pct}%)`);
  for (const k of missing.slice(0, 30)) console.log(`  MISSING  ${JSON.stringify(k.slice(0, 110))}`);
  if (missing.length > 30) console.log(`  MISSING  …and ${missing.length - 30} more`);
  for (const k of orphan.slice(0, 15)) console.log(`  ORPHAN   ${JSON.stringify(k.slice(0, 110))} — source copy changed?`);
  if (orphan.length > 15) console.log(`  ORPHAN   …and ${orphan.length - 15} more`);
}
