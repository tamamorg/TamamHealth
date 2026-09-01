/**
 * Every workflow the UI offers a role must be a write CouchDB will accept.
 *
 * ## The failure this exists to prevent
 *
 * The permission model has four layers (see docs/RBAC-MATRIX.md), and only the
 * last one is real. `usePermissions.ts` decides which buttons a role sees;
 * `hasRole` in api-auth.ts guards the API routes and applies a *station shim*
 * so `triage_nurse` satisfies an allow-list naming `nurse`. The CouchDB
 * validator matches `role:` claims **exactly** and has no shim.
 *
 * So a role could be offered a form, fill it in, and have the document written
 * to its local PouchDB replica — where it looks saved — and then be rejected at
 * replication and never leave the device. There is no error in the UI for that:
 * the write succeeded locally. It is the worst failure shape the platform has,
 * and an audit in Aug 2026 found it live on eight workflows, including patient
 * registration from the registration desk, triage by the triage nurse, imaging
 * reports by the radiologist, dispensing by the pharmacist, and every dose
 * recorded on the ward MAR.
 *
 * ## What the table below is
 *
 * The intended contract, written once: each capability names the roles the UI
 * grants it and the document types exercising it. The role lists mirror
 * `usePermissions.ts` — that module is a React hook and cannot be imported
 * here, so they are restated, and `capability-roles-mirror` below fails if the
 * hook's source text stops agreeing with them.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DOC_WRITE_ROLES, DOC_UPDATE_ONLY_ROLES } from '@/lib/sync/write-permissions';
import { ROLE_ROUTE_TABLE } from '@/lib/role-routes';
import type { UserRole } from '@/lib/db-types';

interface WorkflowCapability {
  /** The `usePermissions` flag this mirrors. */
  flag: string;
  /** Document types the workflow writes. */
  docTypes: string[];
  /** Roles the UI grants the capability to. */
  roles: UserRole[];
  /** True when the workflow only ever amends an existing document. */
  amendsOnly?: boolean;
}

const WORKFLOWS: WorkflowCapability[] = [
  {
    flag: 'canRegisterPatients',
    docTypes: ['patient'],
    roles: [
      'doctor', 'clinical_officer', 'nurse', 'midwife', 'clinician', 'triage_nurse',
      'rooming_nurse', 'central_registration_clerk', 'clinic_clerk', 'front_desk',
      'hrio', 'medical_superintendent',
    ],
  },
  {
    flag: 'canManageReferrals',
    docTypes: ['referral'],
    roles: [
      'doctor', 'clinical_officer', 'nurse', 'clinician', 'midwife',
      'central_registration_clerk', 'front_desk', 'super_admin',
      'medical_superintendent',
    ],
  },
  {
    flag: 'canRecordVitalEvents',
    docTypes: ['birth', 'death', 'immunization', 'anc_visit'],
    roles: [
      'doctor', 'clinical_officer', 'nurse', 'midwife', 'clinician', 'triage_nurse',
      'rooming_nurse', 'records_hmis_officer', 'hrio', 'data_entry_clerk',
      'medical_superintendent',
    ],
  },
  {
    flag: 'canBookAppointments',
    docTypes: ['appointment'],
    roles: [
      'central_registration_clerk', 'clinic_clerk', 'front_desk',
    ],
  },
  {
    flag: 'canConsult',
    docTypes: ['medical_record', 'clinical_note'],
    roles: ['doctor', 'clinical_officer', 'clinician', 'medical_superintendent'],
  },
  {
    flag: 'canPrescribe',
    docTypes: ['prescription'],
    roles: ['doctor', 'clinical_officer', 'clinician', 'medical_superintendent'],
  },
  {
    flag: 'canEnterLabResults',
    docTypes: ['lab_result'],
    roles: ['lab_tech'],
  },
  {
    flag: 'canAssessFacility',
    docTypes: ['facility_assessment'],
    roles: [
      'data_entry_clerk', 'hrio', 'records_hmis_officer', 'medical_superintendent',
      'government', 'county_health_director', 'hospital_manager', 'super_admin',
    ],
  },
  {
    flag: 'canSendMessages',
    docTypes: ['message', 'conversation'],
    roles: [
      'doctor', 'clinical_officer', 'nurse', 'midwife', 'clinician', 'triage_nurse',
      'rooming_nurse', 'central_registration_clerk', 'clinic_clerk',
      'records_hmis_officer', 'front_desk', 'cashier', 'pharmacist', 'lab_tech',
      'county_health_director', 'hrio', 'nutritionist', 'radiologist',
      'medical_superintendent', 'org_admin', 'super_admin',
    ],
  },
  {
    flag: 'canCollectPayments',
    docTypes: ['payment', 'invoice', 'ledger_entry'],
    roles: ['medical_biller', 'cashier', 'medical_superintendent', 'org_admin', 'super_admin'],
  },
  // Workflows with no `usePermissions` flag — gated by the station dashboard
  // itself, which is why they were the easiest to miss.
  {
    flag: '(radiology dashboard → updateLabResult)',
    docTypes: ['lab_result'],
    roles: ['radiologist'],
    amendsOnly: true,
  },
  {
    flag: '(pharmacy queue → advancePrescription)',
    docTypes: ['prescription'],
    roles: ['pharmacist'],
    amendsOnly: true,
  },
  {
    flag: '(ward MAR → recordAdministration)',
    docTypes: ['medication_administration'],
    roles: ['nurse', 'midwife', 'triage_nurse', 'rooming_nurse'],
  },
];

/** Roles permitted to write `type`, counting amend-only grants when allowed. */
function permitted(type: string, includeAmenders: boolean): readonly string[] {
  const base = (DOC_WRITE_ROLES[type] ?? []) as readonly string[];
  if (!includeAmenders) return base;
  return [...base, ...((DOC_UPDATE_ONLY_ROLES[type] ?? []) as readonly string[])];
}

describe('every UI-granted workflow is a write CouchDB accepts', () => {
  for (const workflow of WORKFLOWS) {
    for (const type of workflow.docTypes) {
      it(`${workflow.flag} → ${type}`, () => {
        const allowed = permitted(type, workflow.amendsOnly === true);
        const refused = workflow.roles.filter(role => !allowed.includes(role));
        expect(refused).toEqual([]);
      });
    }
  }
});

describe('amend-only grants do not become authorship', () => {
  it('keeps prescription authorship to prescribing roles', () => {
    const authors = DOC_WRITE_ROLES.prescription as readonly string[];
    for (const role of ['pharmacist', 'nurse', 'midwife', 'triage_nurse', 'rooming_nurse']) {
      expect(authors).not.toContain(role);
    }
  });

  it('routes pharmacy lifecycle changes through amend-only prescription access', () => {
    const amenders = DOC_UPDATE_ONLY_ROLES.prescription as readonly string[];
    expect(amenders).toContain('pharmacist');
    for (const role of ['nurse', 'midwife', 'triage_nurse', 'rooming_nurse']) expect(amenders).not.toContain(role);
  });

  it('records bedside doses as independent append-only documents', () => {
    const authors = DOC_WRITE_ROLES.medication_administration as readonly string[];
    for (const role of ['nurse', 'midwife', 'triage_nurse', 'rooming_nurse']) expect(authors).toContain(role);
  });

  it('never grants a role amend rights it does not need over authorship', () => {
    // An amend-only entry that duplicates the write row is dead weight and
    // hides which of the two is actually carrying the grant.
    for (const [type, amenders] of Object.entries(DOC_UPDATE_ONLY_ROLES)) {
      const authors = (DOC_WRITE_ROLES[type] ?? []) as readonly string[];
      for (const role of amenders) expect(authors).not.toContain(role);
    }
  });
});

describe('audit coverage', () => {
  const everyRole = Object.keys(ROLE_ROUTE_TABLE).sort();

  it('accepts an audit entry from every role that can sign in', () => {
    // A role absent here still writes the entry to its own device; it simply
    // never replicates, so the action leaves no server-side trace.
    expect([...(DOC_WRITE_ROLES.audit_log as readonly string[])].sort()).toEqual(everyRole);
  });

  it('accepts a sync event from every role that can sign in', () => {
    expect([...(DOC_WRITE_ROLES.sync_event as readonly string[])].sort()).toEqual(everyRole);
  });
});

describe('capability-roles-mirror', () => {
  // The role lists above are restated from a React hook that cannot be
  // imported into a non-React test. This reads the hook's source and checks
  // each flag still names exactly the roles the table claims, so the two
  // cannot drift silently.
  const source = readFileSync(
    path.join(process.cwd(), 'src/lib/hooks/usePermissions.ts'),
    'utf8',
  );

  /** `isTriageNurse` → `triage_nurse`, `role === 'doctor'` → `doctor`. */
  const ALIAS: Record<string, UserRole> = {
    isSuperAdmin: 'super_admin', isOrgAdmin: 'org_admin', isGovernment: 'government',
    isDataEntry: 'data_entry_clerk', isHospitalManager: 'hospital_manager',
    isMedicalBiller: 'medical_biller', isCashier: 'cashier', isMidwife: 'midwife',
    isCountyDirector: 'county_health_director', isClinician: 'clinician',
    isTriageNurse: 'triage_nurse', isRoomingNurse: 'rooming_nurse',
    isRegistrationClerk: 'central_registration_clerk', isClinicClerk: 'clinic_clerk',
    isRecordsHmis: 'records_hmis_officer', isMedSupt: 'medical_superintendent',
  };

  function rolesFor(flag: string): UserRole[] {
    const line = source.split('\n').find(l => l.includes(`const ${flag} =`));
    if (!line) throw new Error(`usePermissions.ts no longer declares ${flag}`);
    const expression = line.slice(line.indexOf('=') + 1);
    const found = new Set<UserRole>();
    for (const [, quoted] of expression.matchAll(/role === '([a-z_]+)'/g)) {
      found.add(quoted as UserRole);
    }
    for (const [, alias] of expression.matchAll(/\b(is[A-Z][A-Za-z]+)\b/g)) {
      if (ALIAS[alias]) found.add(ALIAS[alias]);
    }
    return [...found];
  }

  for (const workflow of WORKFLOWS) {
    if (workflow.flag.startsWith('(')) continue; // no flag — dashboard-gated
    it(`${workflow.flag} still names the roles this table expects`, () => {
      expect([...rolesFor(workflow.flag)].sort()).toEqual([...workflow.roles].sort());
    });
  }
});
