import fs from 'node:fs';
import path from 'node:path';

describe('public metadata configuration boundary', () => {
  it('never exposes the private DHIS2 endpoint', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/country/metadata/route.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/process\.env\.DHIS2_BASE_URL/);
    expect(source).toContain('process.env.NEXT_PUBLIC_DHIS2_BASE_URL');
  });
});
