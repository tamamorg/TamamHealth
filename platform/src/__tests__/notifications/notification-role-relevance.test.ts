/**
 * Per-role relevance of notification sources (lib/notification-scope.ts).
 *
 * The bell used to aggregate every facility event for every role: each pending
 * prescription badged the HR officer, each waiting triage patient badged the
 * cashier, and a super admin opened the bell to the operational churn of every
 * facility on the platform. KIND_RELEVANT_ROLES is the coarse cut that stops
 * that — these tests pin who receives which source, and the safety property
 * that per-user and safety-critical kinds are never narrowed.
 */
import { isKindRelevantToRole, type NotificationKind } from '@/lib/notification-scope';

const ALL_KINDS: NotificationKind[] = [
  'alert', 'triage', 'referral', 'lab', 'appointment', 'prescription', 'progress', 'transfer',
];

describe('kinds that must never be narrowed by role', () => {
  it('outbreak alerts and transfers reach every role', () => {
    // Outbreaks are universally safety-relevant; transfers are addressed to a
    // specific user by construction. Both stay on for every role.
    for (const role of ['pharmacist', 'cashier', 'hrio', 'super_admin', 'org_admin', 'medical_biller']) {
      expect(isKindRelevantToRole('alert', role)).toBe(true);
      expect(isKindRelevantToRole('transfer', role)).toBe(true);
    }
  });

  it('keeps everything when there is no role to judge by', () => {
    for (const kind of ALL_KINDS) {
      expect(isKindRelevantToRole(kind, undefined)).toBe(true);
      expect(isKindRelevantToRole(kind, '')).toBe(true);
    }
  });
});

describe('the dispensing queue is pharmacy work', () => {
  it('reaches the pharmacist and the ward nurse (overdue doses)', () => {
    expect(isKindRelevantToRole('prescription', 'pharmacist')).toBe(true);
    expect(isKindRelevantToRole('prescription', 'nurse')).toBe(true);
  });

  it('does not badge the roles that cannot dispense', () => {
    for (const role of ['doctor', 'front_desk', 'cashier', 'hrio', 'lab_tech', 'org_admin', 'super_admin']) {
      expect(isKindRelevantToRole('prescription', role)).toBe(false);
    }
  });
});

describe('the waiting room reaches the people who can empty it', () => {
  it('clinicians, nurses and the front desk see waiting triage', () => {
    for (const role of ['doctor', 'clinical_officer', 'clinician', 'nurse', 'triage_nurse', 'front_desk']) {
      expect(isKindRelevantToRole('triage', role)).toBe(true);
    }
  });

  it('the pharmacy, the lab bench and the billing office do not', () => {
    for (const role of ['pharmacist', 'lab_tech', 'cashier', 'medical_biller', 'hrio', 'super_admin']) {
      expect(isKindRelevantToRole('triage', role)).toBe(false);
    }
  });
});

describe('results go to the people who order, review or produce them', () => {
  it('clinical roles and the lab tech receive lab notifications', () => {
    for (const role of ['doctor', 'clinical_officer', 'nurse', 'midwife', 'lab_tech']) {
      expect(isKindRelevantToRole('lab', role)).toBe(true);
    }
  });

  it('non-clinical roles do not', () => {
    for (const role of ['pharmacist', 'cashier', 'hrio', 'front_desk', 'org_admin', 'super_admin']) {
      expect(isKindRelevantToRole('lab', role)).toBe(false);
    }
  });
});

describe('platform and org administrators keep only what they can act on', () => {
  it.each(['super_admin', 'org_admin'] as const)('%s receives alerts and transfers, not clinical operations', (role) => {
    expect(isKindRelevantToRole('alert', role)).toBe(true);
    expect(isKindRelevantToRole('transfer', role)).toBe(true);
    for (const kind of ['triage', 'referral', 'lab', 'appointment', 'prescription', 'progress'] as const) {
      expect(isKindRelevantToRole(kind, role)).toBe(false);
    }
  });
});

describe('scheduling notifications', () => {
  it('reach providers and the desk roles that run the book', () => {
    for (const role of ['doctor', 'front_desk', 'clinic_clerk', 'central_registration_clerk']) {
      expect(isKindRelevantToRole('appointment', role)).toBe(true);
    }
  });

  it('skip the pharmacy and the lab', () => {
    expect(isKindRelevantToRole('appointment', 'pharmacist')).toBe(false);
    expect(isKindRelevantToRole('appointment', 'lab_tech')).toBe(false);
  });
});

describe('every kind still has someone listening', () => {
  it.each(ALL_KINDS.map(k => [k] as const))('%s reaches at least one facility role', (kind) => {
    const facilityRoles = [
      'doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife', 'triage_nurse',
      'rooming_nurse', 'front_desk', 'pharmacist', 'lab_tech', 'medical_superintendent',
    ];
    expect(facilityRoles.some(role => isKindRelevantToRole(kind, role))).toBe(true);
  });
});
