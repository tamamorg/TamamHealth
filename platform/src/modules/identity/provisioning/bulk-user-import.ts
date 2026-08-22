/**
 * Reading a staff list out of a spreadsheet.
 *
 * A hospital going live has one dialog and one account at a time. Two hundred
 * staff is two hundred trips through a modal, and the practical result is not
 * that somebody spends a long afternoon — it is that the facility gives up and
 * shares logins, which is the failure this whole area exists to prevent.
 *
 * Parsing lives here, apart from the route, because it is the part with all
 * the edge cases and none of the database: a spreadsheet exported from Excel
 * on a Windows machine in Juba arrives with a BOM, CRLF endings, quoted fields
 * containing commas, and a header row somebody has renamed. It is worth being
 * able to test all of that without a CouchDB.
 *
 * NOTHING here creates an account. It turns a file into a list of validated
 * intentions, and the route runs each one through the same `createUser` an
 * administrator uses by hand — so the bulk path cannot become a second, weaker
 * way to make a user.
 */

import type { UserRole } from '@/lib/db-types';
import { ROLE_LABEL } from '@/lib/role-display';
import { roleNeedsFacility, roleNeedsOrganization, isPlatformOnlyRole } from '@/modules/identity/policy/user-scope-rules';

/** Refused outright — a bad paste should not become a thousand accounts. */
export const MAX_IMPORT_ROWS = 500;

export interface ImportRow {
  /** 1-based line number in the file, for an error the user can act on. */
  line: number;
  name: string;
  username: string;
  role: UserRole | '';
  email?: string;
  phone?: string;
  facilityName?: string;
  department?: string;
  /** Why this row cannot be imported, or null when it is ready. */
  problem: string | null;
}

export interface ParsedImport {
  rows: ImportRow[];
  /** Problems with the FILE rather than with a row. */
  fileProblem: string | null;
}

/**
 * Column headings this accepts, mapped to the field they fill.
 *
 * Generous on purpose. The alternative is telling a facility administrator
 * that their column must be called `full_name` and not `Name`, which is a
 * requirement they will meet by retyping two hundred rows.
 */
const HEADER_ALIASES: Record<string, keyof Omit<ImportRow, 'line' | 'problem'>> = {
  name: 'name', 'full name': 'name', fullname: 'name', full_name: 'name', staff: 'name',
  username: 'username', 'user name': 'username', user_name: 'username', login: 'username',
  role: 'role', position: 'role', job: 'role', 'job title': 'role',
  email: 'email', 'e-mail': 'email', 'email address': 'email',
  phone: 'phone', mobile: 'phone', telephone: 'phone', 'phone number': 'phone',
  facility: 'facilityName', hospital: 'facilityName', 'facility name': 'facilityName',
  site: 'facilityName', clinic: 'facilityName',
  department: 'department', unit: 'department', ward: 'department',
};

/** Role names as a human writes them, mapped to the identifier. */
const ROLE_ALIASES = new Map<string, UserRole>();

/**
 * FIRST writer wins for every alias, and this matters.
 *
 * `doctor` and `clinician` share the display label "Doctor" (see ROLE_LABEL).
 * With last-write-wins, a spreadsheet saying "Doctor" would silently create
 * `clinician` accounts — a different role, with a different dashboard, for
 * every physician in the facility. The identifier is always registered for
 * itself, so nothing can shadow an exact match either.
 */
function alias(key: string, role: UserRole): void {
  const normalised = key.trim().toLowerCase();
  if (!normalised || ROLE_ALIASES.has(normalised)) return;
  ROLE_ALIASES.set(normalised, role);
}

for (const [role, label] of Object.entries(ROLE_LABEL)) {
  alias(role, role as UserRole);
  alias(role.replace(/_/g, ' '), role as UserRole);
  alias(label, role as UserRole);
}
// The handful people actually type that match no label.
alias('receptionist', 'front_desk');
alias('reception', 'front_desk');
alias('front desk', 'front_desk');
alias('lab technician', 'lab_tech');
alias('laboratory technician', 'lab_tech');
alias('medical officer', 'clinical_officer');
alias('co', 'clinical_officer');
alias('sister', 'nurse');
alias('matron', 'nurse');
alias('organization admin', 'org_admin');
alias('organisation admin', 'org_admin');
alias('organization administrator', 'org_admin');
alias('organisation administrator', 'org_admin');
alias('administrator', 'org_admin');
alias('health records officer', 'hrio');
alias('records officer', 'records_hmis_officer');

export function resolveRole(raw: string): UserRole | '' {
  return ROLE_ALIASES.get(raw.trim().toLowerCase()) ?? '';
}

/**
 * Split one CSV line, honouring quotes.
 *
 * Written out rather than pulled from a dependency because the whole grammar
 * that matters here is "quotes protect commas, and a doubled quote is a
 * literal one" — and a parser is a poor thing to inherit for a file a stranger
 * uploads.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',' || char === ';' || char === '\t') {
      out.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  out.push(field);
  return out.map(value => value.trim());
}

/** Normalise the username the same way `createUser` will, so what you see is what is created. */
export function normaliseImportUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

/** Derive a username from a name when the column is absent — same shape as the seeded roster. */
export function usernameFromName(name: string): string {
  return normaliseImportUsername(
    name.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().split(/\s+/).slice(0, 2).join('.'),
  );
}

export interface ParseOptions {
  /** Facility names this organisation actually has, for validating the column. */
  knownFacilities?: readonly string[];
  /** Usernames already taken, so a clash is reported before anything is created. */
  takenUsernames?: readonly string[];
  /** True when the importer is an org_admin, who may not grant platform roles. */
  restrictPlatformRoles?: boolean;
}

/**
 * Turn a CSV file into validated rows.
 *
 * Every row is checked; a bad one is REPORTED, not dropped. A silent drop is
 * how a facility ends up believing it imported two hundred people and finds
 * out at go-live that a hundred and ninety-two arrived.
 */
export function parseUserImport(text: string, options: ParseOptions = {}): ParsedImport {
  // Strip a UTF-8 BOM: Excel writes one, and without this the first header is
  // "\uFEFFname", which matches nothing and makes every row fail on a file
  // that looks perfectly correct on screen.
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r\n|\r|\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return { rows: [], fileProblem: 'That file is empty.' };

  const headers = splitCsvLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, ' ').trim());
  const columns = headers.map(h => HEADER_ALIASES[h]);
  if (!columns.includes('name')) {
    return {
      rows: [],
      fileProblem: 'No "Name" column found. The first row must be headings — at least Name and Role.',
    };
  }
  if (!columns.includes('role')) {
    return {
      rows: [],
      fileProblem: 'No "Role" column found. The first row must be headings — at least Name and Role.',
    };
  }
  if (lines.length - 1 > MAX_IMPORT_ROWS) {
    return {
      rows: [],
      fileProblem: `That file has ${lines.length - 1} rows. Import at most ${MAX_IMPORT_ROWS} at a time.`,
    };
  }

  const taken = new Set((options.takenUsernames ?? []).map(u => u.toLowerCase()));
  const facilities = new Map(
    (options.knownFacilities ?? []).map(f => [f.trim().toLowerCase(), f]),
  );
  const seen = new Set<string>();
  const rows: ImportRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    const row: ImportRow = { line: i + 1, name: '', username: '', role: '', problem: null };
    columns.forEach((field, index) => {
      if (!field) return;
      const value = values[index] ?? '';
      if (field === 'role') row.role = resolveRole(value);
      else if (field === 'username') row.username = normaliseImportUsername(value);
      else row[field] = value;
    });

    if (!row.username && row.name) row.username = usernameFromName(row.name);

    const rawRole = values[columns.indexOf('role')] ?? '';
    row.problem = validateRow(row, rawRole, { taken, seen, facilities, options });
    if (row.username) seen.add(row.username);
    rows.push(row);
  }

  return { rows, fileProblem: null };
}

function validateRow(
  row: ImportRow,
  rawRole: string,
  ctx: {
    taken: Set<string>;
    seen: Set<string>;
    facilities: Map<string, string>;
    options: ParseOptions;
  },
): string | null {
  if (!row.name.trim()) return 'No name.';
  if (!row.role) {
    return rawRole.trim()
      ? `"${rawRole.trim()}" is not a role on this platform.`
      : 'No role.';
  }
  if (ctx.options.restrictPlatformRoles && isPlatformOnlyRole(row.role)) {
    return 'Only a platform operator can grant that role.';
  }
  if (row.role === 'super_admin') {
    // Never, from a file. The platform operator comes from the deployment
    // bootstrap; a spreadsheet is the last place that decision should be made.
    return 'Platform administrator accounts cannot be imported.';
  }
  if (!row.username) return 'Could not work out a username — add a Username column.';
  if (row.username.length < 3) return 'Username is too short.';
  if (ctx.taken.has(row.username)) return `Username "${row.username}" already exists.`;
  if (ctx.seen.has(row.username)) return `Username "${row.username}" appears twice in this file.`;
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
    return `"${row.email}" is not a valid email address.`;
  }
  if (roleNeedsOrganization(row.role) && !roleNeedsFacility(row.role)) {
    // org_admin: organisation comes from the importer's own session.
    return null;
  }
  if (roleNeedsFacility(row.role)) {
    if (!row.facilityName?.trim()) return 'This role needs a facility — add a Facility column.';
    // Checked unconditionally, INCLUDING when the organisation has no
    // facilities at all. This used to be guarded by `facilities.size > 0`,
    // which meant an organisation with none silently previewed every row as
    // ready and then failed all of them on commit — the exact difference
    // between preview and outcome that a preview exists to prevent.
    if (ctx.facilities.size === 0) {
      return 'This organization has no facilities yet — register one before importing clinical staff.';
    }
    if (!ctx.facilities.has(row.facilityName.trim().toLowerCase())) {
      return `No facility called "${row.facilityName.trim()}" in this organisation.`;
    }
  }
  return null;
}

/** The template offered for download, so nobody has to guess the columns. */
export const IMPORT_TEMPLATE_CSV = [
  'Name,Username,Role,Email,Phone,Facility,Department',
  'Mary Nyaboth,mary.nyaboth,Nurse,mary@example.org,+211900000000,Juba Teaching Hospital,Maternity',
  'James Wani,,Doctor,,,Juba Teaching Hospital,Outpatients',
].join('\n');
