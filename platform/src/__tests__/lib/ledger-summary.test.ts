/**
 * The account statement must add up.
 *
 * It listed legacy charge documents next to a balance summed from the ledger,
 * so invoices raised by lab orders and prescriptions were in the balance and
 * nowhere on the page: 10,000 charged, 10,000 paid, 7,000 due. Read from the
 * ledger alone, every figure is one view of the same entries.
 */
import { summariseLedger } from '@/lib/ledger-summary';
import type { LedgerEntryDoc } from '@/lib/db-types-payments';

let n = 0;
const entry = (entryType: LedgerEntryDoc['entryType'], amount: number, description: string, at: string) => ({
  _id: `led-${++n}`, type: 'ledger_entry', patientId: 'pat-1', entryType, amount, runningBalance: 0,
  description, currency: 'SSP', facilityId: 'hosp-1', createdAt: at, updatedAt: at,
}) as LedgerEntryDoc;

const ACCOUNT = [
  entry('payment', -10000, 'Cash payment', '2026-03-10T10:00:00.000Z'),
  entry('charge', 10000, 'Consultation + Malaria RDT + Coartem', '2026-03-10T09:00:00.000Z'),
  entry('charge', 7000, 'Admission deposit — INV-1', '2026-09-30T08:00:00.000Z'),
  entry('charge', 3500, 'Full Blood Count — INV-2', '2026-10-03T08:00:00.000Z'),
  entry('insurance_payment', -2000, 'Insurer remittance', '2026-10-03T09:00:00.000Z'),
  entry('adjustment', -3500, 'Bill cancelled — INV-2', '2026-10-03T10:00:00.000Z'),
  entry('refund', 1000, 'Refund of overpayment', '2026-10-03T11:00:00.000Z'),
];

describe('summariseLedger', () => {
  it('reconciles: charged − paid + adjustments + refunded = balance', () => {
    const s = summariseLedger(ACCOUNT);
    expect(s).toMatchObject({ charged: 20500, patientPaid: 10000, insurancePaid: 2000, adjustments: -3500, refunded: 1000, balance: 6000 });
    expect(s.charged - s.patientPaid - s.insurancePaid + s.adjustments + s.refunded).toBe(s.balance);
  });

  it('lists entries oldest first, each with the balance after it', () => {
    const s = summariseLedger(ACCOUNT);
    expect(s.rows.map(row => row.balance)).toEqual([10000, 0, 7000, 10500, 8500, 5000, 6000]);
    expect(s.rows[0].description).toBe('Consultation + Malaria RDT + Coartem');
    expect(s.rows[s.rows.length - 1].balance).toBe(s.balance);
  });

  it('reports a credit as a negative balance', () => {
    const s = summariseLedger([
      entry('charge', 3000, 'Paracetamol — INV-9', '2026-10-03T08:00:00.000Z'),
      entry('payment', -3000, 'Cash', '2026-10-03T08:10:00.000Z'),
      entry('adjustment', -3000, 'Charge reversed — INV-9; refund due', '2026-10-03T08:20:00.000Z'),
    ]);
    expect(s.balance).toBe(-3000);
  });

  it('is all zeroes for an account with no activity, and does not mutate its input', () => {
    expect(summariseLedger([])).toMatchObject({ charged: 0, patientPaid: 0, balance: 0, rows: [] });
    const before = ACCOUNT.map(e => e._id);
    summariseLedger(ACCOUNT);
    expect(ACCOUNT.map(e => e._id)).toEqual(before);
  });

  it('keeps fractions of a unit from drifting', () => {
    const s = summariseLedger([
      entry('charge', 0.1, 'a', '2026-10-03T08:00:00.000Z'),
      entry('charge', 0.2, 'b', '2026-10-03T08:01:00.000Z'),
      entry('payment', -0.3, 'c', '2026-10-03T08:02:00.000Z'),
    ]);
    expect(s.balance).toBe(0);
    expect(s.charged).toBe(0.3);
  });
});
