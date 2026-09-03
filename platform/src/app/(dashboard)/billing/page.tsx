'use client';

/**
 * Billing Home — the cashier's bill registry. One row per invoice; open a
 * bill to work it (finalize, collect, print) on /billing/[id]. The /payments
 * page remains the patient-level A/R cockpit.
 *
 * Restyled 2026-09 onto the shared registry surface (EhrListHeader +
 * data-table) that patients / lab / referrals / deaths already wear — this
 * page was the last list still carrying its own OpenMRS O3-style card, with
 * a breadcrumb head, an inner "Bill List" card and its own pagination strip
 * around a seven-row table.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { formatMoney } from '@/lib/format-utils';
import { formatBillDate, STATUS_CHIP } from '@/components/billing/billing-utils';
import type { BillingDoc } from '@/lib/db-types-billing';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import '@/components/billing/billing.css';
import Select from '@/components/Select';

type FilterKey = 'open' | 'pending' | 'partial' | 'paid' | 'waived' | 'cancelled' | 'all';

const FILTERS: { key: FilterKey; label: string; match: (b: BillingDoc) => boolean }[] = [
  { key: 'open', label: 'Open bills', match: b => b.status === 'pending' || b.status === 'partial' },
  { key: 'pending', label: 'Pending payment', match: b => b.status === 'pending' },
  { key: 'partial', label: 'Partially paid', match: b => b.status === 'partial' },
  { key: 'paid', label: 'Paid', match: b => b.status === 'paid' },
  { key: 'waived', label: 'Waived', match: b => b.status === 'waived' },
  { key: 'cancelled', label: 'Cancelled', match: b => b.status === 'cancelled' },
  { key: 'all', label: 'All bills', match: () => true },
];

/** Rows rendered before "Load more" — same guard the patients registry uses
 *  so a busy facility's bill history doesn't render thousands of rows. */
const PAGE_SIZE = 100;

const BILL_COLS: { key: string; label: string; width: number }[] = [
  { key: 'date', label: 'Bill date', width: 120 },
  { key: 'invoice', label: 'Invoice', width: 170 },
  { key: 'patient', label: 'Patient', width: 200 },
  { key: 'items', label: 'Billed items', width: 320 },
  { key: 'total', label: 'Total', width: 120 },
  { key: 'status', label: 'Status', width: 110 },
];
const BILL_COL_TOTAL = BILL_COLS.reduce((sum, c) => sum + c.width, 0);

export default function BillingHomePage() {
  const router = useRouter();
  const scope = useDataScope();
  const [bills, setBills] = useState<BillingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterKey>('open');
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const loadBills = useCallback(async () => {
    if (!scope) return;
    setLoading(true);
    setError('');
    try {
      const { getAllBills } = await import('@/lib/services/billing-service');
      setBills(await getAllBills(scope) || []);
    } catch (err) {
      console.error('Error loading bills:', err);
      setError('Could not load bills. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { loadBills(); }, [loadBills]);

  const filtered = useMemo(() => {
    const matchStatus = FILTERS.find(f => f.key === filter)?.match ?? (() => true);
    const q = search.trim().toLowerCase();
    return bills.filter(b => {
      if (!matchStatus(b)) return false;
      if (!q) return true;
      return (
        b.patientName?.toLowerCase().includes(q)
        || b.hospitalNumber?.toLowerCase().includes(q)
        || b.invoiceNumber?.toLowerCase().includes(q)
      );
    });
  }, [bills, filter, search]);
  const visible = filtered.slice(0, visibleCount);

  // Header chips: the ledger's standing breakdown, independent of the filter —
  // the same relationship every registry header keeps with its rows.
  const stats = useMemo(() => {
    const count = (match: (b: BillingDoc) => boolean) => bills.filter(match).length;
    return [
      { label: 'Open', value: count(b => b.status === 'pending' || b.status === 'partial'), color: LIST_STAT_COLORS.blue },
      { label: 'Paid', value: count(b => b.status === 'paid'), color: LIST_STAT_COLORS.green },
      { label: 'Waived', value: count(b => b.status === 'waived'), color: LIST_STAT_COLORS.amber },
      { label: 'Cancelled', value: count(b => b.status === 'cancelled'), color: LIST_STAT_COLORS.muted },
    ];
  }, [bills]);

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
        <EhrListHeader
          title="Billing"
          count={bills.length}
          stats={stats}
          search={{
            value: search,
            onChange: v => { setSearch(v); setVisibleCount(PAGE_SIZE); },
            placeholder: 'Search by patient, invoice, or identifier…',
            ariaLabel: 'Search bills',
          }}
          actions={
            <Select
              value={filter}
              aria-label="Filter bills by status"
              onChange={e => { setFilter(e.target.value as FilterKey); setVisibleCount(PAGE_SIZE); }}
            >
              {FILTERS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </Select>
          }
        />
        {error && (
          <div style={{ padding: '10px 16px', color: 'var(--color-danger-text)', fontSize: 13 }}>{error}</div>
        )}
        <div className="ehr-list-scroll">
          <table className="data-table" style={{ minWidth: 1040, tableLayout: 'fixed' }}>
            <colgroup>
              {BILL_COLS.map(c => (
                <col key={c.key} style={{ width: `${(c.width / BILL_COL_TOTAL * 100).toFixed(2)}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {BILL_COLS.map(c => (
                  <th key={c.key} className={c.key === 'total' ? 'text-right' : undefined}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={BILL_COLS.length} className="text-sm p-4" style={{ color: 'var(--text-muted)' }}>Loading bills…</td></tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={BILL_COLS.length} className="text-sm p-4" style={{ color: 'var(--text-muted)' }}>
                    {search ? 'No bills match your search. Try a different name or identifier.' : 'Bills matching this filter will appear here as they are created.'}
                  </td>
                </tr>
              )}
              {!loading && visible.map(bill => {
                const chip = STATUS_CHIP[bill.status];
                return (
                  <tr
                    key={bill._id}
                    className="cursor-pointer hover:bg-[var(--table-row-hover)]"
                    onClick={() => router.push(`/billing/${bill._id}`)}
                  >
                    <td className="text-xs" style={{ whiteSpace: 'nowrap' }}>{formatBillDate(bill.createdAt)}</td>
                    <td>
                      <Link href={`/billing/${bill._id}`} className="text-sm font-semibold" style={{ color: 'var(--accent-text)' }} data-tour="bill-open">
                        {bill.invoiceNumber}
                      </Link>
                    </td>
                    <td>
                      <span className="text-sm font-semibold block truncate">{bill.patientName}</span>
                      <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{bill.hospitalNumber || '—'}</span>
                    </td>
                    <td className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                      {bill.items.length > 0
                        ? bill.items.map(i => i.description).slice(0, 3).join(', ') + (bill.items.length > 3 ? ` +${bill.items.length - 3} more` : '')
                        : '—'}
                    </td>
                    <td className="text-sm font-mono text-right" style={{ whiteSpace: 'nowrap' }}>{formatMoney(bill.totalAmount, { currency: bill.currency })}</td>
                    <td>{chip ? <span className={`bl-chip ${chip.cls}`}>{chip.label}</span> : bill.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length > visible.length && (
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--border-light)' }}>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Showing {visible.length} of {filtered.length} bills</span>
            <button type="button" className="btn btn-secondary" style={{ height: 34 }} onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>
              Load more
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
