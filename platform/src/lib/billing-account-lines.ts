/**
 * A patient's account as the billing tab lists it: one line per visit.
 *
 * The ledger is append-only, so it gains an entry for every payment, refund and
 * adjustment. Listing those entries made every collection a new row beside the
 * charge it paid. Here each entry is folded into the line it belongs to, so the
 * line's status and balance move and the list keeps its length; the entries
 * stay on the line as its updates. Nothing is written back to the ledger.
 *
 * Line balances add up to the ledger's balance: every entry lands on exactly
 * one line, or is split across lines to its full amount.
 *
 * A credit goes to the visit it names (encounter, bill, charge, or the
 * allocation stamped on the payment). Anything else pays the oldest open line
 * first, the order settleOpenBillsWithPayment settles bills in.
 */
import { defaultCurrency } from '@/lib/country/country-pack';
import type {
  ChargeDoc, LedgerEntryDoc, LedgerEntryType, PaymentDoc, RefundDoc,
} from './db-types-payments';
import type { BillingDoc } from './db-types-billing';
import { jubaDate } from './time-juba';

export type AccountLineStatus = 'unpaid' | 'partial' | 'paid' | 'refunded' | 'credit' | 'voided';

/** One thing the patient was charged for. */
export interface AccountLineItem {
  id: string;
  description: string;
  category?: string;
  quantity: number;
  unitPrice?: number;
  total: number;
  /** Claim status of a charge document; bills carry none per item. */
  status?: string;
}

/** One ledger entry, as far as it landed on this line. */
export interface AccountLineUpdate {
  id: string;
  date: string;
  kind: LedgerEntryType;
  description: string;
  /** Signed, this line's share: positive raises what is owed here. */
  amount: number;
  /** Set when the entry was split across visits: its full size. */
  entryAmount?: number;
  /** Line balance after this update. */
  balance: number;
  paymentId?: string;
  reference?: string;
  by?: string;
}

export interface AccountLine {
  id: string;
  /** The visit's first charge. Stays put, so a line never moves when it updates. */
  date: string;
  /** The last entry to touch the line. */
  updatedAt: string;
  items: AccountLineItem[];
  categories: string[];
  charged: number;
  paid: number;
  adjusted: number;
  refunded: number;
  balance: number;
  currency: string;
  status: AccountLineStatus;
  encounterId?: string;
  /** A charge or bill on the line, to stamp a payment taken against it. */
  chargeRef?: string;
  /** Oldest first. */
  updates: AccountLineUpdate[];
  /** Every word the list's search should match, lower case. */
  searchText: string;
}

export interface AccountSources {
  entries: LedgerEntryDoc[];
  charges: ChargeDoc[];
  payments: PaymentDoc[];
  refunds: RefundDoc[];
  bills: BillingDoc[];
}

type Entry = Pick<LedgerEntryDoc, '_id' | 'createdAt' | 'entryType' | 'amount' | 'description' | 'encounterId' | 'referenceId' | 'referenceType' | 'currency'>;
type Bucket = 'charged' | 'paid' | 'adjusted' | 'refunded';

const BUCKET: Record<LedgerEntryType, Bucket> = {
  charge: 'charged', payment: 'paid', insurance_payment: 'paid',
  adjustment: 'adjusted', write_off: 'adjusted', refund: 'refunded',
};

const round = (n: number) => Math.round(n * 100) / 100;

/** An account that predates the ledger reads from its charges and payments. */
function entriesFromDocs(charges: ChargeDoc[], payments: PaymentDoc[]): Entry[] {
  return [
    ...charges.map((c): Entry => ({
      _id: `charge-${c._id}`, createdAt: c.serviceDate || c.createdAt, entryType: 'charge', amount: c.billedAmount,
      description: c.description, encounterId: c.encounterId, referenceId: c._id, referenceType: 'charge', currency: defaultCurrency(),
    })),
    ...payments.filter(p => p.status === 'posted').map((p): Entry => ({
      _id: `payment-${p._id}`, createdAt: p.processedAt, entryType: 'payment', amount: -p.amount,
      description: p.method, encounterId: p.encounterId, referenceId: p._id, referenceType: 'payment', currency: p.currency,
    })),
  ];
}

function itemsFor(entry: Entry, charges: ChargeDoc[], bills: Map<string, BillingDoc>): AccountLineItem[] {
  const bill = entry.referenceId ? bills.get(entry.referenceId) : undefined;
  if (bill?.items.length) {
    return bill.items.map(item => ({
      id: `${bill._id}:${item.id}`, description: item.description, category: item.category,
      quantity: item.quantity, unitPrice: item.unitPrice, total: item.totalPrice,
    }));
  }
  const docs = charges.filter(c => c._id === entry.referenceId || (entry.encounterId && c.encounterId === entry.encounterId));
  if (docs.length) {
    return docs.map(c => ({
      id: c._id, description: c.description, category: c.category, quantity: c.units || 1,
      unitPrice: c.billedAmount, total: round(c.billedAmount * (c.units || 1)), status: c.status,
    }));
  }
  return [{ id: entry._id, description: entry.description, quantity: 1, total: round(Number(entry.amount) || 0) }];
}

/** A voided charge is owed by nobody, so no payment lands on it. */
const isVoided = (line: AccountLine) => line.items.length > 0 && line.items.every(item => item.status === 'voided');

function statusOf(line: AccountLine): AccountLineStatus {
  if (isVoided(line)) return 'voided';
  if (line.balance < 0) return 'credit';
  if (line.refunded > 0 && line.paid - line.refunded <= 0) return 'refunded';
  if (line.balance === 0) return 'paid';
  return line.paid > 0 || line.adjusted > 0 ? 'partial' : 'unpaid';
}

export function buildAccountLines({ entries, charges, payments, refunds, bills }: AccountSources): AccountLine[] {
  const source: Entry[] = entries.length > 0 ? entries : entriesFromDocs(charges, payments);
  const ordered = [...source].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a._id.localeCompare(b._id));
  const paymentById = new Map(payments.map(p => [p._id, p]));
  const refundById = new Map(refunds.map(r => [r._id, r]));
  const billById = new Map(bills.map(b => [b._id, b]));

  const lines = new Map<string, AccountLine>();
  const byReference = new Map<string, AccountLine>();
  const byEncounter = new Map<string, AccountLine>();

  const openLine = (key: string, entry: Entry): AccountLine => {
    let line = lines.get(key);
    if (!line) {
      line = {
        id: key, date: entry.createdAt, updatedAt: entry.createdAt, items: [], categories: [],
        charged: 0, paid: 0, adjusted: 0, refunded: 0, balance: 0, currency: entry.currency || defaultCurrency(),
        status: 'unpaid', updates: [], searchText: '',
      };
      lines.set(key, line);
    }
    return line;
  };

  const post = (line: AccountLine, entry: Entry, amount: number, whole: number) => {
    const bucket = BUCKET[entry.entryType];
    line[bucket] = round(line[bucket] + (bucket === 'charged' || bucket === 'refunded' ? amount : -amount));
    line.balance = round(line.balance + amount);
    if (entry.createdAt > line.updatedAt) line.updatedAt = entry.createdAt;
    const payment = entry.referenceId ? paymentById.get(entry.referenceId) : undefined;
    const refund = entry.referenceId ? refundById.get(entry.referenceId) : undefined;
    line.updates.push({
      id: `${entry._id}:${line.id}`, date: entry.createdAt, kind: entry.entryType, description: entry.description,
      amount: round(amount), entryAmount: round(amount) === round(whole) ? undefined : round(whole), balance: 0,
      paymentId: payment?._id, reference: payment?.reference ?? refund?.reference,
      by: payment?.processedByName ?? refund?.processedByName,
    });
  };

  // Every charge first, so a deposit taken before its charge still finds it.
  for (const entry of ordered) {
    if (entry.entryType !== 'charge') continue;
    const key = entry.encounterId ? `visit:${entry.encounterId}` : `day:${jubaDate(new Date(entry.createdAt))}`;
    const line = openLine(key, entry);
    if (entry.encounterId) line.encounterId = entry.encounterId;
    line.chargeRef ??= entry.referenceId;
    if (entry.referenceId) byReference.set(entry.referenceId, line);
    if (entry.encounterId) byEncounter.set(entry.encounterId, line);
    const seen = new Set(line.items.map(item => item.id));
    line.items.push(...itemsFor(entry, charges, billById).filter(item => !seen.has(item.id)));
    post(line, entry, Number(entry.amount) || 0, Number(entry.amount) || 0);
  }

  const oldestFirst = () => [...lines.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const lastResort = (entry: Entry) => oldestFirst().pop() ?? openLine('account', entry);

  const namedLine = (entry: Entry): AccountLine | undefined => {
    const payment = entry.referenceId ? paymentById.get(entry.referenceId) : undefined;
    const allocation = payment?.allocations?.[0];
    const encounters = [entry.encounterId, allocation?.encounterId, payment?.encounterId];
    const references = [entry.referenceId, allocation?.chargeId];
    return encounters.map(id => (id ? byEncounter.get(id) : undefined)).find(Boolean)
      ?? references.map(id => (id ? byReference.get(id) : undefined)).find(Boolean);
  };

  // Where each payment landed, so its refund or reversal returns to the same lines.
  const landed = new Map<string, { line: AccountLine; amount: number }[]>();

  for (const entry of ordered) {
    if (entry.entryType === 'charge') continue;
    const amount = Number(entry.amount) || 0;
    const whole = amount;
    const named = namedLine(entry);

    if (amount < 0) {
      let left = -amount;
      const targets = named ? [named, ...oldestFirst().filter(l => l !== named)] : oldestFirst();
      for (const line of targets) {
        if (left <= 0) break;
        const portion = round(Math.min(left, Math.max(line.balance, 0)));
        if (portion <= 0 || isVoided(line)) continue;
        post(line, entry, -portion, whole);
        left = round(left - portion);
        if (entry.referenceId) landed.set(entry.referenceId, [...(landed.get(entry.referenceId) ?? []), { line, amount: portion }]);
      }
      // More than anything owes: a credit, kept where the money was aimed.
      if (left > 0) {
        const line = named ?? lastResort(entry);
        post(line, entry, -left, whole);
        if (entry.referenceId) landed.set(entry.referenceId, [...(landed.get(entry.referenceId) ?? []), { line, amount: left }]);
      }
      continue;
    }

    // A refund or a reversal puts back what its payment took off.
    const paymentId = entry.referenceId ? refundById.get(entry.referenceId)?.paymentId ?? entry.referenceId : undefined;
    const sources = (paymentId ? landed.get(paymentId) : undefined) ?? [];
    let left = amount;
    for (const source of [...sources].reverse()) {
      if (left <= 0) break;
      const portion = round(Math.min(left, source.amount));
      if (portion <= 0) continue;
      source.amount = round(source.amount - portion);
      post(source.line, entry, portion, whole);
      left = round(left - portion);
    }
    if (left > 0) post(named ?? lastResort(entry), entry, left, whole);
  }

  return [...lines.values()].map(line => {
    let balance = 0;
    line.updates.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    for (const update of line.updates) {
      balance = round(balance + update.amount);
      update.balance = balance;
    }
    line.categories = [...new Set(line.items.map(item => item.category).filter((c): c is string => !!c))];
    line.status = statusOf(line);
    line.searchText = [
      ...line.items.flatMap(item => [item.description, item.category]),
      ...line.updates.flatMap(update => [update.description, update.reference, update.by]),
      line.chargeRef, line.status,
    ].filter(Boolean).join(' ').toLowerCase();
    return line;
  }).sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0) || a.id.localeCompare(b.id));
}
