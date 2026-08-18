import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Batches are positional: { "from": <index into keys.json>, "values": [...] }.
// Keying them by the English text instead would mean re-typing strings that
// contain non-breaking spaces and typographic dashes, and a single wrong byte
// silently produces an orphan entry that never matches at runtime.
const keys = JSON.parse(readFileSync('.tmp-i18n/keys.json', 'utf8'));
const dict = {};
for (const f of readdirSync('.tmp-i18n/batches').sort()) {
  if (!f.endsWith('.json')) continue;
  const { from, values } = JSON.parse(readFileSync(join('.tmp-i18n/batches', f), 'utf8'));
  values.forEach((v, i) => {
    const k = keys[from + i];
    if (k === undefined) throw new Error(`${f}: index ${from + i} is past the end of keys.json`);
    if (v !== null && v !== '') dict[k] = v;
  });
}
const missing = keys.filter((k) => dict[k] === undefined);

if (process.argv[2] === 'check') {
  console.log(`keys ${keys.length} | translated ${keys.length - missing.length} | missing ${missing.length}`);
  const firstGap = keys.findIndex((k) => dict[k] === undefined);
  if (firstGap >= 0) console.log(`next untranslated index: ${firstGap}`);
  process.exit(0);
}
if (missing.length) { console.error(`refusing: ${missing.length} untranslated`); process.exit(1); }

const head = `import type { Dictionary } from './index';

/**
 * Arabic (Juba) — عربي جوبا.
 *
 * Keys are the English source strings exactly as they appear in \`site-data.ts\`
 * and in the components' \`t("…")\` calls; values are the Juba Arabic rendering.
 * Anything absent falls through to English rather than rendering blank, so a
 * half-filled dictionary degrades instead of breaking — \`npm run i18n:check\`
 * lists what is still missing, and flags entries orphaned by an edit to the
 * English copy.
 */
export const apd: Dictionary = {
`;
writeFileSync('src/lib/i18n/apd.ts',
  head + keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(dict[k])},`).join('\n') + '\n};\n');
console.log(`wrote apd.ts with ${keys.length} entries`);
