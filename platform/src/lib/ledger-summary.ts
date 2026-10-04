/**
 * A patient's account, read from the ledger — the same entries the balance is
 * summed from.
 *
 * The statement and the billing tab used to total "charged" from the legacy
 * charge documents while taking the balance from the ledger. Most charges now
 * arrive as invoices (lab orders, prescriptions, the superbill), which post to
 * the ledger but are not charge documents — so a patient with 10,000 SSP of
 * listed charges, 10,000 paid, could be shown owing 7,000, and no line on the
 * page explained it. Every figure here comes from the one source, so
 *
 *     charged − paid + adjustments + refunded = balance
 *
 * holds by construction, and each row carries the balance after it.
 */
import type { LedgerEntryDoc } from './db-types-payments';

export interface LedgerRow {
  id: string;
  date: string;
  description: string;
  kind: LedgerEntryDoc['entryType'];
  /** Signed: positive raises what the patient owes, negative lowers it. */
  amount: number;
  /** Account balance after this entry. */
  balance: number;
}

export interface LedgerSummary {
  /** Total of charge entries. */
  charged: number;
  /** Patient payments received (a positive figure). */
  patientPaid: number;
  /** Insurer payments received (a positive figure). */
  insurancePaid: number;
  /** Adjustments and write-offs, signed (usually negative). */
  adjustments: number;
  /** Refunds paid back out to the patient (a positive figure). */
  refunded: number;
  /** What is owed now; negative is a credit the facility owes the patient. */
  balance: number;
  /** Oldest first, each with the running balance. */
  rows: LedgerRow[];
}

const round = (n: number) => Math.round(n * 100) / 100;

export function summariseLedger(entries: LedgerEntryDoc[]): LedgerSummary {
  const ordered = [...entries].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const summary: LedgerSummary = {
    charged: 0, patientPaid: 0, insurancePaid: 0, adjustments: 0, refunded: 0, balance: 0, rows: [],
  };
  for (const entry of ordered) {
    const amount = Number(entry.amount) || 0;
    switch (entry.entryType) {
      case 'charge': summary.charged += amount; break;
      case 'payment': summary.patientPaid -= amount; break;
      case 'insurance_payment': summary.insurancePaid -= amount; break;
      case 'refund': summary.refunded += amount; break;
      default: summary.adjustments += amount; break; // adjustment, write_off
    }
    summary.balance += amount;
    summary.rows.push({
      id: entry._id,
      date: entry.createdAt,
      description: entry.description,
      kind: entry.entryType,
      amount: round(amount),
      balance: round(summary.balance),
    });
  }
  summary.charged = round(summary.charged);
  summary.patientPaid = round(summary.patientPaid);
  summary.insurancePaid = round(summary.insurancePaid);
  summary.adjustments = round(summary.adjustments);
  summary.refunded = round(summary.refunded);
  summary.balance = round(summary.balance);
  return summary;
}
