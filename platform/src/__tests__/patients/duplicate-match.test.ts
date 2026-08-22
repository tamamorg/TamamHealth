/** @jest-environment node */
/**
 * Possible-duplicate detection at the registration desk.
 *
 * The `reg.duplicates` setting — "Warn on possible duplicates: matches name,
 * age, and locality" — was read by the registration form into a variable that
 * was never used. The toggle did nothing in either position, which is worse
 * than a missing feature: the desk believed the check was running.
 *
 * The two failure modes pull in opposite directions and both are tested here.
 * Too strict and it finds nothing, because a name transcribed by ear is not
 * spelled the same way twice. Too loose and it fires on unrelated patients,
 * the desk learns to dismiss it, and it is still being dismissed when a real
 * duplicate arrives. The false-positive cases below are therefore as
 * load-bearing as the true-positive ones.
 */
import {
  findPossibleDuplicates, withinOneEdit, normalizeName,
} from '@/lib/patients/duplicate-match';
import type { PatientDoc } from '@/lib/db-types';

const patient = (over: Partial<PatientDoc>): PatientDoc => ({
  _id: 'pat-1', type: 'patient', hospitalNumber: 'JTH-0001',
  firstName: 'Achol', middleName: '', surname: 'Deng',
  dateOfBirth: '1990-05-02', gender: 'Female',
  state: 'Central Equatoria', county: 'Juba',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
} as unknown as PatientDoc);

const candidate = {
  firstName: 'Achol', surname: 'Deng', dateOfBirth: '1990-05-02',
  gender: 'Female', state: 'Central Equatoria', county: 'Juba',
};

describe('the person entered twice', () => {
  it('flags an exact re-registration as strong', () => {
    const [hit] = findPossibleDuplicates(candidate, [patient({})]);
    expect(hit).toBeDefined();
    expect(hit.strength).toBe('strong');
    expect(hit.reasons).toContainEqual({ code: 'name-exact' });
  });

  it('surfaces the existing hospital number, which is what the clerk looks up', () => {
    const [hit] = findPossibleDuplicates(candidate, [patient({})]);
    expect(hit.reasons).toContainEqual({ code: 'hospital-number', number: 'JTH-0001' });
  });

  it('catches a name transcribed by ear', () => {
    // "Acol" for "Achol" is one edit, and is how the same person is written by
    // two different clerks. An exact-match-only check finds nothing here,
    // which is the state this replaces.
    const [hit] = findPossibleDuplicates(
      candidate, [patient({ firstName: 'Acol' } as Partial<PatientDoc>)],
    );
    expect(hit).toBeDefined();
    expect(hit.strength).toBe('possible');
    expect(hit.reasons).toContainEqual({ code: 'name-similar' });
  });

  it('matches on an estimated age when neither record has a real birth date', () => {
    // Most patients arrive with no document and an age the clerk guesses.
    const hits = findPossibleDuplicates(
      { ...candidate, dateOfBirth: undefined, estimatedAge: 36 },
      [patient({ dateOfBirth: undefined, estimatedAge: 35 } as Partial<PatientDoc>)],
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].reasons).toContainEqual({ code: 'age-near', gap: 1 });
  });

  it('ignores case, punctuation and accents in the name', () => {
    const hits = findPossibleDuplicates(
      { ...candidate, firstName: '  ACHOL ', surname: "D'eng" },
      [patient({})],
    );
    expect(hits).toHaveLength(1);
  });

  it('reads a married patient’s maiden name as a surname', () => {
    const hits = findPossibleDuplicates(
      candidate, [patient({ surname: 'Lado', maidenName: 'Deng' } as Partial<PatientDoc>)],
    );
    expect(hits).toHaveLength(1);
  });
});

describe('people who are not duplicates', () => {
  it('does not match a different surname', () => {
    expect(findPossibleDuplicates(candidate, [patient({ surname: 'Lado' })])).toEqual([]);
  });

  it('does not match a sibling in the same household', () => {
    // Same surname, same county, same age band, different first name — the
    // single most common false positive a naive check produces.
    expect(findPossibleDuplicates(candidate, [patient({ firstName: 'Nyandeng' })])).toEqual([]);
  });

  it('does not match across a two-edit gap on a short name', () => {
    // "Deng" -> "Peng" is one edit and allowed; "Deng" -> "Pang" is two and
    // must not be, or every short South Sudanese surname collides.
    expect(findPossibleDuplicates(candidate, [patient({ surname: 'Pang' })])).toEqual([]);
  });

  it('requires an exact match on names too short to spell wrong', () => {
    const near = { ...candidate, firstName: 'Ann', surname: 'Bol' };
    expect(findPossibleDuplicates(near, [patient({ firstName: 'Anu', surname: 'Bol' })])).toEqual([]);
  });

  it('does not match a namesake in another county', () => {
    expect(findPossibleDuplicates(candidate, [patient({ county: 'Yei', state: 'Central Equatoria' })])).toEqual([]);
  });

  it('does not match a namesake a decade apart', () => {
    // A child named for a grandparent. Same name, same county, not the same
    // person — and this is the pairing that actually occurs.
    expect(findPossibleDuplicates(candidate, [patient({ dateOfBirth: '1955-05-02' })])).toEqual([]);
  });

  it('does not match when the recorded sex differs', () => {
    expect(findPossibleDuplicates(candidate, [patient({ gender: 'Male' })])).toEqual([]);
  });

  it('does not treat an unknown age as agreement', () => {
    // Otherwise this silently degrades to a name-and-county check, which
    // matches relatives freely.
    expect(findPossibleDuplicates(
      candidate, [patient({ dateOfBirth: undefined, estimatedAge: undefined } as Partial<PatientDoc>)],
    )).toEqual([]);
  });

  it('returns nothing when the form has only half a name typed', () => {
    // The check runs against a form in progress; a lone first name matches
    // hundreds of people and must not produce a warning.
    expect(findPossibleDuplicates({ ...candidate, surname: '' }, [patient({})])).toEqual([]);
    expect(findPossibleDuplicates({ ...candidate, firstName: '' }, [patient({})])).toEqual([]);
  });
});

describe('locality falls back to state only when a county is missing', () => {
  it('accepts a state match when the stored record has no county', () => {
    expect(findPossibleDuplicates(candidate, [patient({ county: '' })])).toHaveLength(1);
  });

  it('still refuses a state match when both records name a county', () => {
    expect(findPossibleDuplicates(candidate, [patient({ county: 'Terekeka' })])).toEqual([]);
  });
});

describe('what the desk is shown', () => {
  it('puts strong matches first', () => {
    const hits = findPossibleDuplicates(candidate, [
      patient({ _id: 'pat-fuzzy', firstName: 'Acol' } as Partial<PatientDoc>),
      patient({ _id: 'pat-exact' }),
    ]);
    expect(hits.map(h => h.patient._id)).toEqual(['pat-exact', 'pat-fuzzy']);
  });

  it('breaks ties toward the most recently registered record', () => {
    const hits = findPossibleDuplicates(candidate, [
      patient({ _id: 'pat-old', createdAt: '2020-01-01T00:00:00.000Z' } as Partial<PatientDoc>),
      patient({ _id: 'pat-new', createdAt: '2026-08-01T00:00:00.000Z' } as Partial<PatientDoc>),
    ]);
    expect(hits[0].patient._id).toBe('pat-new');
  });

  it('caps the list so a common name cannot bury the desk', () => {
    const many = Array.from({ length: 12 }, (_, i) => patient({ _id: `pat-${i}` }));
    expect(findPossibleDuplicates(candidate, many)).toHaveLength(5);
  });

  it('survives a roster of records with missing names', () => {
    const hits = findPossibleDuplicates(candidate, [
      patient({ _id: 'blank', firstName: '', surname: '' } as Partial<PatientDoc>),
      patient({ _id: 'real' }),
    ]);
    expect(hits.map(h => h.patient._id)).toEqual(['real']);
  });
});

describe('the edit-distance primitive', () => {
  it.each([
    ['deng', 'deng', true],
    ['achol', 'acol', true],    // deletion
    ['acol', 'achol', true],    // insertion
    ['deng', 'dang', true],     // substitution
    ['deng', 'pang', false],    // two substitutions
    ['deng', 'de', false],      // two deletions
    ['nyandeng', 'nyandeeng', true],
  ])('%s ~ %s -> %s', (a, b, expected) => {
    expect(withinOneEdit(a, b)).toBe(expected);
  });

  it('is symmetric', () => {
    expect(withinOneEdit('achol', 'acol')).toBe(withinOneEdit('acol', 'achol'));
  });
});

describe('reasons are codes, not sentences', () => {
  it('never returns a formatted English string', () => {
    // The form renders in English and in Juba Arabic. A reason built in this
    // module would reach an Arabic-reading clerk in English, and the i18n
    // ratchet only scans components — it cannot see a literal that arrives
    // from a lib.
    const [hit] = findPossibleDuplicates(candidate, [patient({})]);
    for (const reason of hit.reasons) {
      expect(typeof reason).toBe('object');
      expect(reason.code).toMatch(/^[a-z-]+$/);
    }
  });
});

describe('name normalisation', () => {
  it('strips accents so a transliterated name compares equal', () => {
    expect(normalizeName('Améla')).toBe('amela');
  });

  it('collapses punctuation and repeated spaces', () => {
    // The hyphen separates two name parts; the apostrophe does not.
    expect(normalizeName("  Nyan-Deng   D'eng ")).toBe('nyan deng deng');
  });

  it('is safe on an undefined field', () => {
    expect(normalizeName(undefined)).toBe('');
  });
});
