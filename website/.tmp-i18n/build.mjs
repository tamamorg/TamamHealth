import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Text-keyed. An earlier positional scheme broke the moment new copy shifted
// every index, so the dictionary is keyed by the English source string itself —
// the same key the runtime looks up.
const keys = JSON.parse(readFileSync('.tmp-i18n/keys.json', 'utf8'));
const dict = JSON.parse(readFileSync('.tmp-i18n/base.json', 'utf8'));
for (const f of readdirSync('.tmp-i18n/batches').sort()) {
  if (f.endsWith('.json') && f.startsWith('add-')) {
    Object.assign(dict, JSON.parse(readFileSync(join('.tmp-i18n/batches', f), 'utf8')));
  }
}
const missing = keys.filter((k) => dict[k] === undefined);
const orphan = Object.keys(dict).filter((k) => !keys.includes(k));

if (process.argv[2] === 'check') {
  console.log(`keys ${keys.length} | translated ${keys.length - missing.length} | missing ${missing.length} | orphan ${orphan.length}`);
  if (missing.length) console.log('missing:', missing.slice(0, 10));
  process.exit(0);
}
if (missing.length) { console.error(`refusing: ${missing.length} untranslated`); process.exit(1); }

const head = `import type { Dictionary } from './index';

/**
 * Arabic (Juba) — عربي جوبا.
 *
 * Keys are the English source strings exactly as they appear in \`site-data.ts\`
 * and in the components' translate calls; values are the Juba Arabic rendering.
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
