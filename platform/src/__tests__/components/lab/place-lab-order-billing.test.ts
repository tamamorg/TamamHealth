/**
 * placeLabOrder must say when a lab order produced no bill.
 *
 * A test with no catalogued price (and no laboratory fee to fall back on) made
 * chargeForServices return null, and a failed desk encounter skipped billing
 * entirely: both left the order unbilled with nothing on screen and nothing in
 * the console. Billing no longer depends on the encounter, and the receipt
 * reports what could not be billed so the caller can warn.
 */
import { placeLabOrder } from '@/components/lab/order/place-lab-order';
import { emptyLabOrderDraft } from '@/components/lab/order/lab-order-types';
import type { PatientDoc } from '@/lib/db-types';

const ensureLabOrderEncounter = jest.fn();
const appendLabOrderIds = jest.fn();
const createLabResult = jest.fn();
const chargeForServices = jest.fn();

jest.mock('uuid', () => ({ v4: () => 'uuid' }));
jest.mock('@/lib/services/encounter-service', () => ({
  ensureLabOrderEncounter: (...a: unknown[]) => ensureLabOrderEncounter(...a),
  appendLabOrderIds: (...a: unknown[]) => appendLabOrderIds(...a),
}));
jest.mock('@/lib/services/lab-service', () => ({ createLabResult: (...a: unknown[]) => createLabResult(...a) }));
jest.mock('@/lib/services/fee-schedule-service', () => ({ chargeForServices: (...a: unknown[]) => chargeForServices(...a) }));
jest.mock('@/lib/services/audit-service', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));

const patient = { _id: 'p1', firstName: 'Achol', surname: 'Deng', registrationHospital: 'h-1' } as unknown as PatientDoc;
const user = { _id: 'u1', name: 'Dr A', role: 'doctor' as const, orgId: 'org-a', hospitalId: 'h-1' };
const cbc = { name: 'CBC', specimen: 'Blood', tier: 'basic' as const };
const malaria = { name: 'Malaria RDT', specimen: 'Blood', tier: 'basic' as const };
const draft = (tests = [cbc]) => ({ ...emptyLabOrderDraft('Dr A'), patientId: 'p1', tests });

let warn: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  ensureLabOrderEncounter.mockResolvedValue({ _id: 'enc-1' });
  let n = 0;
  createLabResult.mockImplementation(async () => ({ _id: `lab-${++n}`, accessionNumber: `ACC-${n}` }));
});
afterEach(() => warn.mockRestore());

describe('placeLabOrder billing outcome', () => {
  it('reports billed when every test lands on the bill', async () => {
    chargeForServices.mockResolvedValue({ items: [{ referenceId: 'lab-1' }] });
    const receipt = await placeLabOrder({ patient, currentUser: user, draft: draft() });
    expect(receipt.billed).toBe(true);
    expect(receipt.unbilledTests).toEqual([]);
  });

  it('reports unbilled, and warns, when nothing is priced (chargeForServices returns null)', async () => {
    chargeForServices.mockResolvedValue(null);
    const receipt = await placeLabOrder({ patient, currentUser: user, draft: draft() });
    expect(receipt.billed).toBe(false);
    expect(receipt.unbilledTests).toEqual(['CBC']);
    expect(receipt.createdIds).toEqual(['lab-1']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no bill raised'));
  });

  it('names only the tests that missed the bill when some are priced', async () => {
    chargeForServices.mockResolvedValue({ items: [{ referenceId: 'lab-1' }] });
    const receipt = await placeLabOrder({ patient, currentUser: user, draft: draft([cbc, malaria]) });
    expect(receipt.billed).toBe(false);
    expect(receipt.unbilledTests).toEqual(['Malaria RDT']);
  });

  it('still bills when the desk encounter could not be opened', async () => {
    ensureLabOrderEncounter.mockRejectedValue(new Error('boom'));
    chargeForServices.mockResolvedValue({ items: [{ referenceId: 'lab-1' }] });
    const receipt = await placeLabOrder({ patient, currentUser: user, draft: draft() });
    expect(chargeForServices).toHaveBeenCalledTimes(1);
    expect(chargeForServices.mock.calls[0][0].encounterId).toBeUndefined();
    expect(receipt.billed).toBe(true);
    expect(receipt.encounterId).toBeUndefined();
  });

  it('reports unbilled, and warns, when billing throws', async () => {
    chargeForServices.mockRejectedValue(new Error('db down'));
    const receipt = await placeLabOrder({ patient, currentUser: user, draft: draft() });
    expect(receipt.billed).toBe(false);
    expect(receipt.unbilledTests).toEqual(['CBC']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not bill'), expect.any(Error));
  });
});
