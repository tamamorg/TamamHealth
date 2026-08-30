import { escapeCsvCell, rowsToCsv } from '@/lib/csv';

describe('spreadsheet-safe CSV encoding', () => {
  it.each(['=HYPERLINK("https://evil.example")', '+cmd', '-1+1', '@SUM(A1:A2)'])(
    'neutralizes formula-like input: %s',
    (value) => {
      const encoded = escapeCsvCell(value);
      const decoded = encoded.startsWith('"')
        ? encoded.slice(1, -1).replace(/""/g, '"')
        : encoded;
      expect(decoded).toBe(`'${value}`);
    },
  );

  it('detects formulas after whitespace and quotes CSV control characters', () => {
    expect(escapeCsvCell('  =1+1')).toBe("'  =1+1");
    expect(escapeCsvCell('Doe, "Jane"')).toBe('"Doe, ""Jane"""');
  });

  it('encodes every row through the hardened cell encoder', () => {
    expect(rowsToCsv(['name'], [['=1+1']])).toBe("name\n'=1+1");
  });

  it('preserves negative numeric values as numbers', () => {
    expect(escapeCsvCell(-42)).toBe('-42');
  });
});
