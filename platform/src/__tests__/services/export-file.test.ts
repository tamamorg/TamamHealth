/**
 * CSV serialisation and browser downloads.
 *
 * Four national-reporting pages each carried a copy of this. The behaviour
 * pinned here is mostly what they already did; the parts that are new are the
 * UTF-8 BOM (without which Excel on Windows mangles every non-ASCII name in an
 * exported register) and the deferred `revokeObjectURL`.
 */
import {
  toCsv, toCsvRows, downloadCsv, downloadCsvText, downloadJson,
  downloadFile, safeFilenamePart,
} from '@/lib/export-file';

const BOM = '﻿';

describe('toCsv', () => {
  it('derives headers from the first row and quotes every cell', () => {
    expect(toCsv([{ name: 'Achol', doses: 3 }])).toBe('"name","doses"\n"Achol","3"');
  });

  it('takes an explicit column order when given one', () => {
    expect(toCsv([{ a: 1, b: 2 }], ['b', 'a'])).toBe('"b","a"\n"2","1"');
  });

  it('escapes embedded quotes by doubling them', () => {
    expect(toCsv([{ note: 'said "hello"' }])).toBe('"note"\n"said ""hello"""');
  });

  it('keeps a comma inside a cell from splitting the row', () => {
    const csv = toCsv([{ name: 'Deng, Mary' }]);
    expect(csv).toBe('"name"\n"Deng, Mary"');
  });

  it('keeps a newline inside a cell quoted rather than breaking the record', () => {
    expect(toCsv([{ note: 'line1\nline2' }])).toBe('"note"\n"line1\nline2"');
  });

  it('renders null and undefined as empty, not as the words', () => {
    expect(toCsv([{ a: null, b: undefined }])).toBe('"a","b"\n"",""');
  });

  it('returns nothing for no rows', () => {
    expect(toCsv([])).toBe('');
  });

  it('fills a column a later row is missing', () => {
    expect(toCsv([{ a: 1, b: 2 }, { a: 3 }], ['a', 'b'])).toBe('"a","b"\n"1","2"\n"3",""');
  });
});

describe('toCsvRows', () => {
  it('serialises a header plus positional rows', () => {
    expect(toCsvRows(['Child', 'Doses'], [['Nyakong', 4]]))
      .toBe('"Child","Doses"\n"Nyakong","4"');
  });
});

describe('downloads', () => {
  let clicked: { href: string; download: string } | null;
  let created: string[];
  let revoked: string[];
  let blobs: { parts: unknown[]; type: string }[];

  beforeEach(() => {
    jest.useFakeTimers();
    clicked = null; created = []; revoked = []; blobs = [];

    global.URL.createObjectURL = jest.fn((blob: Blob) => {
      // Capture what actually went into the blob — the BOM is the point.
      const url = `blob:${created.length}`;
      created.push(url);
      return url;
    }) as unknown as typeof URL.createObjectURL;
    global.URL.revokeObjectURL = jest.fn((url: string) => { revoked.push(url); });

    const OriginalBlob = global.Blob;
    global.Blob = class extends OriginalBlob {
      constructor(parts: unknown[], opts?: BlobPropertyBag) {
        super(parts as BlobPart[], opts);
        blobs.push({ parts, type: opts?.type ?? '' });
      }
    } as unknown as typeof Blob;

    jest.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = { href: '', download: '', rel: '', click: jest.fn(() => { clicked = { href: el.href, download: el.download }; }) };
      return el as unknown as HTMLElement;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const written = () => String(blobs[0].parts[0]);

  it('prepends the UTF-8 BOM so Excel reads names correctly', () => {
    downloadCsv([{ name: 'Nyandeng' }], 'roster');
    expect(written().startsWith(BOM)).toBe(true);
    expect(blobs[0].type).toBe('text/csv;charset=utf-8');
  });

  it('omits the BOM when the file is for another system to parse', () => {
    // A strict parser reads it as part of the first column name.
    downloadCsv([{ dataElement: 'X' }], 'dhis2', { bom: false });
    expect(written().startsWith(BOM)).toBe(false);
    expect(written().startsWith('"dataElement"')).toBe(true);
  });

  it('appends the extension only when it is missing', () => {
    downloadCsv([{ a: 1 }], 'roster');
    expect(clicked!.download).toBe('roster.csv');
    downloadCsv([{ a: 1 }], 'already.csv');
    expect(clicked!.download).toBe('already.csv');
  });

  it('reports an empty export instead of appearing to do nothing', () => {
    expect(downloadCsv([], 'empty')).toBe(false);
    expect(clicked).toBeNull();
  });

  it('revokes the object URL after the click, not during it', () => {
    // Revoking synchronously produces a download that silently fails in Safari.
    downloadFile('x', 'a.txt', 'text/plain');
    expect(revoked).toEqual([]);
    jest.runAllTimers();
    expect(revoked).toEqual(created);
  });

  it('writes JSON without a BOM', () => {
    downloadJson({ ok: true }, 'payload');
    expect(written().startsWith(BOM)).toBe(false);
    expect(JSON.parse(written())).toEqual({ ok: true });
    expect(clicked!.download).toBe('payload.json');
    expect(blobs[0].type).toBe('application/json');
  });

  it('passes pre-serialised text straight through', () => {
    downloadCsvText('"a"\n"1"', 'manual');
    expect(written()).toBe(`${BOM}"a"\n"1"`);
  });
});

describe('safeFilenamePart', () => {
  it('replaces characters that break a download name', () => {
    // A slash in a vaccine name truncated the filename to the last segment.
    expect(safeFilenamePart('DPT-HepB/Hib 1')).toBe('dpt-hepb-hib-1');
  });

  it('collapses whitespace and trims stray separators', () => {
    expect(safeFilenamePart('  Week 32  (2026) ')).toBe('week-32-(2026)');
  });

  it('strips the characters Windows rejects outright', () => {
    expect(safeFilenamePart('a?b*c:d|e"f<g>h')).toBe('a-b-c-d-e-f-g-h');
  });
});
