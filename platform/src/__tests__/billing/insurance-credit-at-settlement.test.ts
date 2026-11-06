/**
 * Insurance must be credited to a bill only when a claim is settled, never at
 * bill creation. Crediting the coverage percent at creation double-counted once
 * a claim later settled against the same bill, and a denied claim never put the
 * balance back on the patient (security/data audit 2026-11-05, §2.1 #6).
 *
 * The expected coverage percent is still RECORDED on the bill (for the claim
 * workflow and the UI), it is just not treated as money received.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-ics` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { createBill } from '@/lib/services/billing-service';
import { getPatientLedger } from '@/lib/services/ledger-service';
import type { DataScope } from '@/lib/services/data-scope';

const SUPER: DataScope = { role: 'super_admin' };

afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

function insuredBill() {
  return createBill({
    patientId: 'pat-1', patientName: 'Test Patient',
    facilityId: 'hosp-1', facilityName: 'F', facilityLevel: 'clinic',
    encounterDate: '2026-11-06',
    items: [{ id: 'li-1', category: 'consultation', description: 'Consult', quantity: 1, unitPrice: 1000, totalPrice: 1000 } as never],
    generatedBy: 'u', generatedByName: 'U', state: 'CES', orgId: 'org-a',
    insuranceProvider: 'Nile Assurance', insuranceCoveragePercent: 80,
  } as never);
}

describe('insurance credited at settlement only', () => {
  it('a new insured bill owes the full amount and records the coverage percent', async () => {
    const bill = await insuredBill();
    expect(bill.insuranceCoveragePercent).toBe(80); // recorded as the expected split
    expect(bill.amountPaid).toBe(0);                // NOT credited yet
    expect(bill.balanceDue).toBe(1000);
    expect(bill.status).toBe('pending');            // never auto-"paid"
  });

  it('creation posts only the charge debit to the ledger — no insurance credit', async () => {
    await insuredBill();
    const ledger = await getPatientLedger('pat-1', undefined, SUPER);
    expect(ledger.filter(e => e.entryType === 'charge')).toHaveLength(1);
    expect(ledger.filter(e => e.entryType === 'insurance_payment')).toHaveLength(0);
  });
});
