import catalog from '@/lib/phi-field-catalog.json';
import { DATABASE_DOCUMENT_TYPES } from '@/lib/sync/sync-config';

type CatalogEntry = { fields: string[]; blindIndex?: Record<string, string>; alsoFor?: string[] };

describe('PHI field catalog contract', () => {
  const entries = catalog.types as Record<string, CatalogEntry>;
  const registeredTypes = new Set(Object.values(DATABASE_DOCUMENT_TYPES).flat());

  it('only names document types that can actually be stored and synchronized', () => {
    expect(Object.keys(entries).filter(type => !registeredTypes.has(type))).toEqual([]);
  });

  it('has unique, syntactically valid encrypted paths', () => {
    const invalid: string[] = [];
    const duplicates: string[] = [];
    for (const [type, entry] of Object.entries(entries)) {
      if (new Set(entry.fields).size !== entry.fields.length) duplicates.push(type);
      for (const path of entry.fields) {
        if (!/^[A-Za-z][A-Za-z0-9_]*(?:\[\])?(?:\.[A-Za-z][A-Za-z0-9_]*(?:\[\])?)*(?:\.\*\*)?$/.test(path)) {
          invalid.push(`${type}.${path}`);
        }
      }
    }
    expect(duplicates).toEqual([]);
    expect(invalid).toEqual([]);
  });

  it('creates blind indexes only from fields that are encrypted', () => {
    const invalid: string[] = [];
    for (const [type, entry] of Object.entries(entries)) {
      for (const source of Object.keys(entry.blindIndex ?? {})) {
        if (!entry.fields.includes(source)) invalid.push(`${type}.${source}`);
      }
    }
    expect(invalid).toEqual([]);
  });
});
