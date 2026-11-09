/**
 * A `t('some.key')` call whose key is in neither locale prints the key itself
 * ("SBAR.LATESTVITALS" over the patient portal's vitals, "billing.activityColumn.type"
 * in a printed statement). The parity check only compares the two locale files, so a
 * key that was removed (or never added) from both passes it. This reads every literal
 * key used in the app and fails on one that does not exist.
 */
import fs from 'fs';
import path from 'path';
import en from '@/lib/i18n/locales/en';

const SRC = path.resolve(__dirname, '../..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('literal translation keys', () => {
  it('every t(\'dotted.key\') used in the app exists in the English locale', () => {
    const known = new Set(Object.keys(en as Record<string, string>));
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      for (const match of code.matchAll(/\bt\(\s*'([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]+)'/g)) {
        if (!known.has(match[1])) missing.push(`${path.relative(SRC, file)}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
