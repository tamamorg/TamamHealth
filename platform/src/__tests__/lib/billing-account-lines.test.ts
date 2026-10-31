/**
 * One billing line per visit: the ledger keeps every entry, the list does not
 * grow with them, and the lines still add up to the ledger's balance.
 */
import { buildAccountLines, type AccountSources } from '@/lib/billing-account-lines';
import { summariseLedger } from '@/lib/ledger-summary';
import type { ChargeDoc, LedgerEntryDoc, PaymentDoc, RefundDoc } from '@/lib/db-types-payments';
import type { BillingDoc } from '@/lib/db-types-billing';

const entry = (id: string, day: number, entryType: LedgerEntryDoc['entryType'], amount: number, extra: Partial<LedgerEntryDoc> = {}) => ({
  _id: id, type: 'ledger_entry', patientId: 'p', entryType, amount, runningBalance: 0, description: id, currency: 'SSP', facilityId: 'h',
  createdAt: `2026-10-${String(day).padStart(2, '0')}T08:00:00.000Z`, updatedAt: '', ...extra,
}) as LedgerEntryDoc;
const payment = (id: string, extra: Partial<PaymentDoc> = {}) => ({ _id: id, method: 'cash', amount: 0, status: 'posted', reference: `REC-${id}`, processedByName: 'Amira', ...extra }) as PaymentDoc;
const build = (sources: Partial<AccountSources>) => buildAccountLines({ entries: [], charges: [], payments: [], refunds: [], bills: [], ...sources });
const total = (lines: ReturnType<typeof build>) => Math.round(lines.reduce((sum, line) => sum + line.balance, 0) * 100) / 100;

describe('buildAccountLines', () => {
  it('keeps one line however many times a visit is paid', () => {
    const entries = [
      entry('c1', 20, 'charge', 8000, { encounterId: 'e1' }),
      entry('p1', 21, 'payment', -3000, { referenceId: 'pay-1', referenceType: 'payment' }),
      entry('p2', 22, 'payment', -5000, { referenceId: 'pay-2', referenceType: 'payment' }),
    ];
    const payments = [payment('pay-1', { amount: 3000 }), payment('pay-2', { amount: 5000 })];
    const lines = build({ entries, payments });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ status: 'paid', charged: 8000, paid: 8000, balance: 0 });
    expect(lines[0].updates.map(update => update.balance)).toEqual([8000, 5000, 0]);
    expect(lines[0].updates[2]).toMatchObject({ paymentId: 'pay-2', reference: 'REC-pay-2', by: 'Amira' });
    expect(lines[0].date).toBe(entries[0].createdAt);
    expect(lines[0].updatedAt).toBe(entries[2].createdAt);
  });

  it('reads part paid until the balance is cleared', () => {
    const lines = build({ entries: [entry('c1', 20, 'charge', 8000), entry('p1', 21, 'payment', -3000)] });
    expect(lines[0]).toMatchObject({ status: 'partial', balance: 5000 });
  });

  it('pays the oldest open visit first and splits across visits', () => {
    const entries = [
      entry('c1', 10, 'charge', 1000, { encounterId: 'e1' }),
      entry('c2', 20, 'charge', 1000, { encounterId: 'e2' }),
      entry('p1', 21, 'payment', -1500),
    ];
    const [newer, older] = build({ entries });
    expect(older).toMatchObject({ encounterId: 'e1', status: 'paid' });
    expect(newer).toMatchObject({ encounterId: 'e2', status: 'partial', balance: 500 });
    expect(newer.updates.at(-1)).toMatchObject({ amount: -500, entryAmount: -1500 });
  });

  it('lands a payment on the visit it was taken against', () => {
    const entries = [
      entry('c1', 10, 'charge', 1000, { encounterId: 'e1' }),
      entry('c2', 20, 'charge', 1000, { encounterId: 'e2' }),
      entry('p1', 21, 'payment', -1000, { referenceId: 'pay-1', referenceType: 'payment' }),
    ];
    const payments = [payment('pay-1', { amount: 1000, allocations: [{ encounterId: 'e2', amount: 1000 }] })];
    const [newer, older] = build({ entries, payments });
    expect(newer).toMatchObject({ encounterId: 'e2', status: 'paid' });
    expect(older).toMatchObject({ encounterId: 'e1', status: 'unpaid' });
  });

  it('finds a visit with no encounter by its charge reference', () => {
    const entries = [
      entry('c1', 10, 'charge', 1000, { referenceId: 'chg-1' }),
      entry('c2', 20, 'charge', 1000, { referenceId: 'chg-2' }),
      entry('p1', 21, 'payment', -1000, { referenceId: 'pay-1', referenceType: 'payment' }),
    ];
    const payments = [payment('pay-1', { amount: 1000, allocations: [{ encounterId: '', chargeId: 'chg-2', amount: 1000 }] })];
    const [newer] = build({ entries, payments });
    expect(newer).toMatchObject({ chargeRef: 'chg-2', status: 'paid' });
  });

  it('puts a refund back on the line its payment paid', () => {
    const entries = [
      entry('c1', 10, 'charge', 1000, { encounterId: 'e1' }),
      entry('c2', 20, 'charge', 1000, { encounterId: 'e2' }),
      entry('p1', 21, 'payment', -1000, { referenceId: 'pay-1', referenceType: 'payment', encounterId: 'e2' }),
      entry('r1', 22, 'refund', 1000, { referenceId: 'ref-1', referenceType: 'refund' }),
    ];
    const refunds = [{ _id: 'ref-1', paymentId: 'pay-1', processedByName: 'Amira' }] as RefundDoc[];
    const [newer, older] = build({ entries, refunds, payments: [payment('pay-1', { amount: 1000 })] });
    expect(newer).toMatchObject({ encounterId: 'e2', status: 'refunded', balance: 1000 });
    expect(older.updates).toHaveLength(1);
  });

  it('undoes a reversed payment on the same line', () => {
    const entries = [
      entry('c1', 10, 'charge', 1000, { encounterId: 'e1' }),
      entry('p1', 11, 'payment', -1000, { referenceId: 'pay-1', referenceType: 'payment' }),
      entry('p2', 12, 'payment', 1000, { referenceId: 'pay-1', referenceType: 'payment' }),
    ];
    const lines = build({ entries, payments: [payment('pay-1', { amount: 1000, status: 'reversed' })] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ status: 'unpaid', paid: 0, balance: 1000 });
  });

  it('keeps an overpayment as a credit, and a payment with no charge on its own line', () => {
    expect(build({ entries: [entry('c1', 10, 'charge', 100), entry('p1', 11, 'payment', -150)] })[0])
      .toMatchObject({ status: 'credit', balance: -50 });
    const [line] = build({ entries: [entry('p1', 11, 'payment', -150)] });
    expect(line).toMatchObject({ id: 'account', status: 'credit', items: [] });
  });

  it('lists what a bill charged, not its invoice number', () => {
    const entries = [entry('c1', 10, 'charge', 700, { referenceId: 'bill-1', referenceType: 'billing', description: 'Invoice INV-1' })];
    const bills = [{ _id: 'bill-1', items: [
      { id: 'a', category: 'lab', description: 'Malaria RDT', quantity: 1, unitPrice: 200, totalPrice: 200 },
      { id: 'b', category: 'pharmacy', description: 'Coartem', quantity: 1, unitPrice: 500, totalPrice: 500 },
    ] }] as BillingDoc[];
    const [line] = build({ entries, bills });
    expect(line.items.map(item => item.description)).toEqual(['Malaria RDT', 'Coartem']);
    expect(line.categories).toEqual(['lab', 'pharmacy']);
  });

  it('shows both charge documents of a visit once when the ledger posted them together', () => {
    const entries = [entry('c1', 10, 'charge', 8000, { encounterId: 'e1', referenceId: 'chg-1' })];
    const charges = [
      { _id: 'chg-1', encounterId: 'e1', description: 'Consultation', category: 'consultation', units: 1, billedAmount: 5000, status: 'approved' },
      { _id: 'chg-2', encounterId: 'e1', description: 'FBC', category: 'lab', units: 1, billedAmount: 3000, status: 'approved' },
    ] as ChargeDoc[];
    const [line] = build({ entries, charges });
    expect(line.items.map(item => item.description)).toEqual(['Consultation', 'FBC']);
    expect(line.charged).toBe(8000);
  });

  it('does not pay a voided line', () => {
    const entries = [
      entry('c1', 10, 'charge', 100, { encounterId: 'e1', referenceId: 'chg-1' }),
      entry('c2', 20, 'charge', 100, { encounterId: 'e2' }),
      entry('p1', 21, 'payment', -100),
    ];
    const charges = [{ _id: 'chg-1', encounterId: 'e1', description: 'Void', units: 1, billedAmount: 100, status: 'voided' }] as ChargeDoc[];
    const [newer, older] = build({ entries, charges });
    expect(older.status).toBe('voided');
    expect(newer.status).toBe('paid');
  });

  it('adds up to the ledger balance', () => {
    const entries = [
      entry('c1', 10, 'charge', 1000, { encounterId: 'e1' }),
      entry('c2', 12, 'charge', 400),
      entry('p1', 13, 'payment', -1200),
      entry('a1', 14, 'write_off', -100, { encounterId: 'e1' }),
      entry('r1', 15, 'refund', 50),
      entry('i1', 16, 'insurance_payment', -80),
    ];
    expect(total(build({ entries }))).toBe(summariseLedger(entries).balance);
  });

  it('reads an account with no ledger from its charges and payments', () => {
    const charges = [{ _id: 'chg-1', encounterId: 'e1', description: 'Old fee', category: 'registration', units: 1, billedAmount: 200, status: 'approved', serviceDate: '2026-01-02' }] as ChargeDoc[];
    const lines = build({ charges, payments: [payment('pay-1', { amount: 200, processedAt: '2026-01-03T08:00:00.000Z', encounterId: 'e1' })] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ status: 'paid', balance: 0 });
  });
});
