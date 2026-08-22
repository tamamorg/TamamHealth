/**
 * @jest-environment node
 *
 * Reading a staff list out of a spreadsheet.
 *
 * The file this parses is exported from Excel on a Windows machine and emailed
 * to a facility administrator, so the failure modes are mundane and specific:
 * a byte-order mark, CRLF endings, a heading somebody renamed, a role written
 * the way a person says it. Every one of those turning into "import failed"
 * means the facility goes back to sharing logins.
 */
import {
  parseUserImport, splitCsvLine, resolveRole, usernameFromName,
  IMPORT_TEMPLATE_CSV, MAX_IMPORT_ROWS,
} from '@/modules/identity/provisioning/bulk-user-import';

const HEADER = 'Name,Username,Role,Email,Phone,Facility,Department';
const FACILITIES = ['Juba Teaching Hospital', 'Wau State Hospital'];

const parse = (body: string, extra = {}) =>
  parseUserImport(`${HEADER}\n${body}`, { knownFacilities: FACILITIES, ...extra });

describe('splitting a line', () => {
  it('honours quotes around a field containing a comma', () => {
    expect(splitCsvLine('"Deng, Mary",nurse')).toEqual(['Deng, Mary', 'nurse']);
  });

  it('reads a doubled quote as a literal one', () => {
    expect(splitCsvLine('"She said ""yes""",x')).toEqual(['She said "yes"', 'x']);
  });

  it('accepts semicolons and tabs, which is what a European Excel writes', () => {
    expect(splitCsvLine('a;b')).toEqual(['a', 'b']);
    expect(splitCsvLine('a\tb')).toEqual(['a', 'b']);
  });
});

describe('roles as a person writes them', () => {
  it('accepts the identifier, the label, and the spoken form', () => {
    expect(resolveRole('nurse')).toBe('nurse');
    expect(resolveRole('Lab Tech')).toBe('lab_tech');
    expect(resolveRole('lab technician')).toBe('lab_tech');
    expect(resolveRole('Receptionist')).toBe('front_desk');
    expect(resolveRole('clinical officer')).toBe('clinical_officer');
  });

  it('resolves a shared label to the role a person means', () => {
    // `doctor` and `clinician` both display as "Doctor". Resolving to
    // `clinician` would silently give every physician in the file a different
    // role, with a different dashboard, than the one the list asked for.
    expect(resolveRole('Doctor')).toBe('doctor');
    expect(resolveRole('clinician')).toBe('clinician');
  });

  it('returns nothing for a job title this platform does not have', () => {
    expect(resolveRole('Hospital Chaplain')).toBe('');
  });
});

describe('the file itself', () => {
  it('survives a byte-order mark from Excel', () => {
    // Without stripping this the first heading is "﻿Name", nothing
    // matches, and every row fails on a file that looks perfect on screen.
    const parsed = parseUserImport(`﻿${HEADER}\nMary,,Nurse,,,Juba Teaching Hospital,`, {
      knownFacilities: FACILITIES,
    });
    expect(parsed.fileProblem).toBeNull();
    expect(parsed.rows[0].problem).toBeNull();
  });

  it('survives CRLF endings', () => {
    const parsed = parseUserImport(`${HEADER}\r\nMary,,Nurse,,,Juba Teaching Hospital,\r\n`, {
      knownFacilities: FACILITIES,
    });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].problem).toBeNull();
  });

  it('accepts headings that have been renamed to something sensible', () => {
    const parsed = parseUserImport('Full Name,Job Title,Hospital\nMary,Nurse,Wau State Hospital', {
      knownFacilities: FACILITIES,
    });
    expect(parsed.fileProblem).toBeNull();
    expect(parsed.rows[0]).toMatchObject({ name: 'Mary', role: 'nurse' });
  });

  it('says which heading is missing rather than failing silently', () => {
    expect(parseUserImport('Name,Email\nMary,m@x.co').fileProblem).toMatch(/"Role" column/);
    expect(parseUserImport('Role\nNurse').fileProblem).toMatch(/"Name" column/);
  });

  it('refuses a file too large to be a deliberate import', () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `P${i},,Nurse,,,Juba Teaching Hospital,`);
    expect(parseUserImport(`${HEADER}\n${rows.join('\n')}`).fileProblem)
      .toMatch(new RegExp(`at most ${MAX_IMPORT_ROWS}`));
  });

  it('parses its own template', () => {
    const parsed = parseUserImport(IMPORT_TEMPLATE_CSV, { knownFacilities: FACILITIES });
    expect(parsed.fileProblem).toBeNull();
    expect(parsed.rows.every(r => r.problem === null)).toBe(true);
  });
});

describe('usernames', () => {
  it('derives one from the name when the column is blank', () => {
    expect(usernameFromName('Mary Nyaboth Deng')).toBe('mary.nyaboth');
    expect(usernameFromName('Achol  Mayen')).toBe('achol.mayen');
  });

  it('normalises exactly as createUser will, so the preview is the truth', () => {
    const parsed = parse('X,"Mary O\'Brien!",Nurse,,,Juba Teaching Hospital,');
    expect(parsed.rows[0].username).toBe('maryobrien');
  });

  it('reports a clash with an existing account', () => {
    const parsed = parse('Mary Nyaboth,,Nurse,,,Juba Teaching Hospital,', {
      takenUsernames: ['mary.nyaboth'],
    });
    expect(parsed.rows[0].problem).toMatch(/already exists/);
  });

  it('reports a duplicate inside the file itself', () => {
    const parsed = parse([
      'Mary Nyaboth,,Nurse,,,Juba Teaching Hospital,',
      'Mary Nyaboth,,Nurse,,,Juba Teaching Hospital,',
    ].join('\n'));
    expect(parsed.rows[0].problem).toBeNull();
    expect(parsed.rows[1].problem).toMatch(/twice in this file/);
  });
});

describe('what a row must have', () => {
  it('reports a bad row rather than dropping it', () => {
    // A silent drop is how a facility believes it imported two hundred people
    // and discovers at go-live that a hundred and ninety-two arrived.
    const parsed = parse([
      'Mary,,Nurse,,,Juba Teaching Hospital,',
      ',,Nurse,,,Juba Teaching Hospital,',
      'Peter,,Hospital Chaplain,,,Juba Teaching Hospital,',
    ].join('\n'));
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[1].problem).toMatch(/No name/);
    expect(parsed.rows[2].problem).toMatch(/not a role/);
  });

  it('requires a facility for a facility-bound role, and checks it exists', () => {
    expect(parse('Mary,,Nurse,,,,').rows[0].problem).toMatch(/needs a facility/);
    expect(parse('Mary,,Nurse,,,Nowhere Clinic,').rows[0].problem).toMatch(/No facility called/);
  });

  it('does not preview a row as ready when the org has no facilities at all', () => {
    // The preview and the commit must agree. This case used to skip facility
    // validation entirely and report every clinical row as ready, and the
    // import then failed all of them — which is precisely the surprise the
    // preview step exists to remove.
    const parsed = parseUserImport(`${HEADER}\nMary,,Nurse,,,Anywhere,`, { knownFacilities: [] });
    expect(parsed.rows[0].problem).toMatch(/no facilities yet/);
  });

  it('does not demand a facility for an organisation-wide role', () => {
    expect(parse('Ann,,Org Admin,,,,').rows[0].problem).toBeNull();
    // Spelled the way a person writes it, either side of the Atlantic.
    expect(parse('Ann,,Organisation Administrator,,,,').rows[0].problem).toBeNull();
  });

  it('validates the email before anything tries to send to it', () => {
    expect(parse('Mary,,Nurse,not-an-email,,Juba Teaching Hospital,').rows[0].problem)
      .toMatch(/not a valid email/);
  });

  it('never lets a spreadsheet mint a platform administrator', () => {
    expect(parse('Mary,,Super Admin,,,,').rows[0].problem).toMatch(/cannot be imported/);
  });

  it('keeps an org admin inside the roles they may grant', () => {
    const asOrgAdmin = parse('Mary,,Government,,,,', { restrictPlatformRoles: true });
    expect(asOrgAdmin.rows[0].problem).toMatch(/platform operator/);
    const asPlatform = parse('Mary,,Government,,,,');
    expect(asPlatform.rows[0].problem).toBeNull();
  });
});
