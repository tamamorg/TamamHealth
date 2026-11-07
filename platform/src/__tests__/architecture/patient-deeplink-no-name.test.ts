/**
 * @jest-environment node
 *
 * Security audit 2026-11 L3: no link may put a patient's name in a URL
 * (browser history, the service worker's page cache). Lab and pharmacy use
 * ?patientId=<id>; referrals ?patient=<id>.
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

describe('patient deep-links carry an id, never a name', () => {
  it('no source builds a patient= query value from a name expression', () => {
    const linkRe = /[?&]patient(?:Id)?=\$\{([^}]*)\}/g;
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const source = fs.readFileSync(file, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(source))) {
        if (/name/i.test(m[1])) offenders.push(`${path.relative(ROOT, file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('lab and pharmacy read ?patientId= and still honour a legacy ?patient= name', () => {
    for (const page of ['lab', 'pharmacy']) {
      const source = fs.readFileSync(path.join(ROOT, 'app/(dashboard)', page, 'page.tsx'), 'utf8');
      expect(source).toContain("searchParams?.get('patientId')");
      expect(source).toContain("searchParams?.get('patient')");
    }
  });
});
