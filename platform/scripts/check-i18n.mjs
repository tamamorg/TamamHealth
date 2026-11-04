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
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES_DIR = join(ROOT, 'src', 'lib', 'i18n', 'locales');
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

// ── Untranslated UI text ────────────────────────────────────────────────────
//
// Everything above is a PARITY check: it proves apd covers en.ts. It is good at
// that and blind to the thing people assume it catches — a string that never
// became a key at all. A sentence hardcoded into JSX passes every assertion
// above, because there is no key for it to be missing.
//
// So AGENTS.md said "every new user-facing string needs both locales —
// npm run i18n:check fails otherwise", the check passed, and 25 dashboard pages
// were English-only in a bilingual RTL product.
//
// This pass is a RATCHET, not a gate. The list below records the files that are
// KNOWN PENDING TRANSLATION — every one of them has no `useTranslation` at all,
// so the fix is "translate the page", not "translate this line". The build fails
// when a file NOT on that list gains hardcoded text, and when a listed file is
// finally translated but its entry is left behind.
//
// It deliberately does NOT track a per-file count. An earlier version did, and
// it fired the moment somebody added two more action labels to a page that was
// already 100% untranslated — noise that says nothing new and trains people to
// bump the number. What matters is a clean file going bad.
const SCAN_ROOTS = ['src/app', 'src/components'];

/** Files known to be pending translation. Delete an entry once its page adopts
 *  `useTranslation`; never add one to silence a new violation. */
const UNTRANSLATED_BASELINE = new Map(Object.entries({
  'src/components/ehr/EhrClinicalDashboard.tsx': 20,
  'src/components/patients/BillingTab.tsx': 11,
  'src/components/ehr/chart/ChartHeader.tsx': 6,
  'src/components/clinical-notes/CareCoordinationModal.tsx': 5,
  'src/app/terms/page.tsx': 4,
  'src/components/MessagingDock.tsx': 4,
  'src/components/ehr/chart/panels/VisitNotePanel.tsx': 4,
  'src/app/global-error.tsx': 3,
  'src/components/ForcePasswordChange.tsx': 3,
  'src/components/clinical-notes/prescribe/PrescribeModal.tsx': 3,
  'src/components/AnnouncementsPanel.tsx': 2,
  'src/components/PublicLegalShell.tsx': 1,
}));

/**
 * JSX text nodes that read as a user-facing sentence.
 *
 * Counted the same way whether or not the file imports `useTranslation`. An
 * earlier version exempted files that did, on the theory that they had opted
 * in — which hid the worse case: 41 files import the hook AND still carry 231
 * literal strings between them. A fully-English screen is at least honest; a
 * half-translated one shows a Juba Arabic reader Arabic and English in the
 * same sentence.
 */
function untranslatedCount(source) {
  const matches = source.match(/>\s*[A-Z][a-zA-Z]+(?: [a-zA-Z&/]+){1,6}\s*</g) || [];
  return matches.length;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

let scanned = 0;
const regressions = [];
const improved = [];
for (const root of SCAN_ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    const rel = relative(ROOT, file);
    const count = untranslatedCount(readFileSync(file, 'utf8'));
    scanned++;
    const pending = UNTRANSLATED_BASELINE.has(rel);
    if (count > 0 && !pending) {
      regressions.push(`  UNTRANSLATED ${rel} — ${count} literal string(s) on a file that had none`);
    } else if (count === 0 && pending) {
      improved.push(`  ${rel} is translated — remove it from UNTRANSLATED_BASELINE in scripts/check-i18n.mjs`);
    }
  }
}
console.log(`\nscanned ${scanned} components for untranslated text`);
for (const r of regressions) report(r);
if (improved.length) {
  console.error('\nThese pages are now translated — the pending list is stale:');
  for (const i of improved) report(i);
}

if (failures) {
  console.error(`\ni18n check failed with ${failures} problem(s).`);
  process.exit(1);
}
console.log('\ni18n check passed — locales cover en.ts, and no new untranslated UI text.');
