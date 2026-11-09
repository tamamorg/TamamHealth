/**
 * The two ends of a cross-organisation referral (patient.referredOut on the
 * sender's chart, patient.referredFrom on the receiver's copy) are written by
 * the server only. A device may neither set, change nor clear them: setting
 * referredOut would lock a chart, and forging referredFrom would claim a
 * referral that never happened. Every other patient write is judged as before.
 */
import { ORG_SCOPED_VALIDATE_FN } from '@/lib/sync/validate-doc-update';

type Ctx = { name?: string; roles: string[] };
type Fn = (n: Record<string, unknown>, o: Record<string, unknown> | null, u: Ctx, s?: unknown) => void;
const validate = new Function(`return (${ORG_SCOPED_VALIDATE_FN});`)() as Fn;
const reason = (n: Record<string, unknown>, o: Record<string, unknown> | null, u: Ctx): string | null => {
  try { validate(n, o, u, {}); return null; } catch (e) { return (e as { forbidden?: string }).forbidden ?? 'thrown'; }
};

const SEALED = 'oenc:v1:b3JnLWE:aXY:Y2lwaGVy';
const doctor: Ctx = { name: 'doc', roles: ['org:org-a', 'role:doctor', 'user:u-doc', 'facility:h-1'] };
const deskClerk: Ctx = { name: 'desk', roles: ['org:org-a', 'role:front_desk', 'user:u-desk', 'facility:h-1'] };
const server: Ctx = { name: 'server', roles: ['_admin'] };

const patient = (over: Record<string, unknown> = {}) => ({
  _id: 'pat-1', _rev: '2-a', type: 'patient', orgId: 'org-a', registrationHospital: 'h-1',
  firstName: SEALED, surname: SEALED, ...over,
});
const referredOut = {
  referralId: 'ref-1', toOrgId: 'org-b', toHospitalId: 'h-9', receiverPatientId: 'pat-1--org-b', at: '2026-11-08T08:00:00.000Z',
};
const referredFrom = { referralId: 'ref-1', patientId: 'pat-1', orgId: 'org-a', hospitalId: 'h-1', at: '2026-11-08T08:00:00.000Z' };

describe('patient.referredOut / referredFrom', () => {
  test('the server may mark a chart referred out and create the receiver copy', () => {
    expect(reason(patient({ _rev: '3-a', referredOut }), patient(), server)).toBeNull();
    expect(reason(patient({ _id: 'pat-1--org-b', orgId: 'org-b', referredFrom }), null, server)).toBeNull();
  });

  test.each([['doctor', doctor], ['front desk', deskClerk]])('a %s device cannot set referredOut', (_n, who) => {
    expect(reason(patient({ _rev: '3-a', referredOut }), patient(), who)).toMatch(/referredOut is written by the server/);
  });

  test('a device cannot create a chart that claims to come from a referral', () => {
    expect(reason(patient({ _id: 'pat-2', _rev: undefined, referredFrom }), null, doctor)).toMatch(/referredFrom is written by the server/);
    expect(reason(patient({ _rev: '3-a', referredFrom }), patient(), doctor)).toMatch(/referredFrom is written by the server/);
  });

  test('a device cannot clear or rewrite the link the server set', () => {
    const marked = patient({ referredOut });
    expect(reason(patient({ _rev: '3-a' }), marked, doctor)).toMatch(/referredOut/);
    expect(reason(patient({ _rev: '3-a', referredOut: { ...referredOut, toOrgId: 'org-c' } }), marked, doctor)).toMatch(/referredOut/);
  });

  test('an ordinary write to a marked chart, leaving the link as it was, is judged as before', () => {
    const marked = patient({ referredOut });
    expect(reason(patient({ _rev: '3-a', referredOut, state: 'Central Equatoria' }), marked, doctor)).toBeNull();
  });

  test('a patient without a link is written exactly as before', () => {
    expect(reason(patient({ _rev: '3-a', state: 'Central Equatoria' }), patient(), doctor)).toBeNull();
  });
});
