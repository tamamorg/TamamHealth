/**
 * @jest-environment node
 *
 * A /referrals?patient= deep-link must carry the patient's id, never their
 * name: a URL with a name lands in browser history as patient-identifying data
 * (security/data audit 2026-11-05, §2.1 #20). The referrals filter matches on
 * patientId, so the id works and leaks nothing. This guard fails if any source
 * builds that link from a *Name expression.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('referrals deep-link carries an id, not a name', () => {
  it('no source builds /referrals?patient= from a name expression', () => {
    // Matches /referrals?patient=${ <expr up to the closing brace> }
    const linkRe = /\/referrals\?patient=\$\{([^}]*)\}/g;
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const source = fs.readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(source))) {
        if (/name/i.test(m[1])) {
          offenders.push(`${path.relative(ROOT, file)}: ${m[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
