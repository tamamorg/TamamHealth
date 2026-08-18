import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const keys = JSON.parse(readFileSync('.tmp-i18n/keys.json', 'utf8'));
const dict = {};
for (const f of readdirSync('.tmp-i18n/batches').sort()) {
  if (f.endsWith('.json')) Object.assign(dict, JSON.parse(readFileSync(join('.tmp-i18n/batches', f), 'utf8')));
}
const missing = keys.filter((k) => dict[k] === undefined);
const orphan = Object.keys(dict).filter((k) => !keys.includes(k));

if (process.argv[2] === 'check') {
  console.log(`keys ${keys.length} | translated ${keys.length - missing.length} | missing ${missing.length} | orphan ${orphan.length}`);
  writeFileSync('/tmp/web-missing.txt', missing.join('\n===\n'));
  if (orphan.length) console.log('orphans:', orphan.slice(0, 5));
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
const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(dict[k])},`).join('\n');
writeFileSync('src/lib/i18n/apd.ts', head + body + '\n};\n');
console.log(`wrote apd.ts with ${keys.length} entries`);
