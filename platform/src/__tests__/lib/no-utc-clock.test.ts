/**
 * @jest-environment node
 *
 * `iso.slice(11, 16)` is the UTC clock: a form saved at 18:07 in Juba would
 * read 16:07 on the chart. Browser code uses localClockOf (lib/date-utils).
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['__tests__', 'api'].includes(entry.name)) walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

describe('clinical times are local', () => {
  it('no browser code reads the clock out of an ISO string', () => {
    const offenders = walk(SRC).flatMap(file => {
      const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      return /\.slice\(11, *16\)/.test(source) ? [path.relative(SRC, file)] : [];
    });
    expect(offenders).toEqual([]);
  });
});
