'use client';

/**
 * Billing Home — OpenMRS O3-style bill list. A cashier's landing view: filter
 * bills by status, search by patient name/identifier/invoice, and open a bill
 * to work it (finalize, collect, print) on /billing/[id].
 *
 * This is invoice-level (one row per bill); the /payments page remains the
 * patient-level A/R cockpit.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/lib/context';
import { Receipt, Search, ChevronLeft, ChevronRight, Activity } from '@/components/icons/lucide';
import { formatMoney } from '@/lib/format-utils';
import { formatBillDate, STATUS_CHIP } from '@/components/billing/billing-utils';
import type { BillingDoc } from '@/lib/db-types-billing';
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

const PER_PAGE_OPTIONS = [10, 20, 30, 50];

export default function BillingHomePage() {
  const { currentUser } = useApp();
  const [bills, setBills] = useState<BillingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterKey>('open');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const scope = useMemo(() => (
    currentUser ? { orgId: currentUser.orgId, hospitalId: currentUser.hospitalId, role: currentUser.role } : undefined
  ), [currentUser]);

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

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * perPage, safePage * perPage);
  const rangeStart = filtered.length === 0 ? 0 : (safePage - 1) * perPage + 1;
  const rangeEnd = Math.min(safePage * perPage, filtered.length);

  return (
    <main className="page-container page-enter">
      <div className="bl-root">
        <div className="bl-home-head">
          <div className="bl-home-icon"><Receipt size={24} /></div>
          <div>
            <p className="bl-eyebrow">Billing</p>
            <h1 className="bl-title">Home</h1>
          </div>
        </div>

        <div className="bl-filter-row">
          <span>Filter by:</span>
          <Select
            value={filter}
            aria-label="Filter bills by status"
            onChange={e => { setFilter(e.target.value as FilterKey); setPage(1); }}
          >
            {FILTERS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </Select>
        </div>

        {error && <div className="bl-card" style={{ padding: '14px 18px', color: 'var(--color-danger-text)' }}>{error}</div>}

        <div className="bl-card">
          <div className="bl-card-head">
            <h2 className="bl-card-title">Bill List</h2>
            <span className="bl-underline" />
          </div>

          <div className="bl-search">
            <Search size={16} />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Filter bills by patient name or identifier"
              aria-label="Filter bills by patient name or identifier"
            />
          </div>

          {loading ? (
            <div className="bl-loading">
              <Activity size={30} style={{ animation: 'spin 1s linear infinite' }} />
              <span>Loading bills…</span>
            </div>
          ) : pageRows.length === 0 ? (
            <div className="bl-empty">
              <Receipt size={34} />
              <h3>No bills to display</h3>
              <p>{search ? 'No bills match your search. Try a different name or identifier.' : 'Bills matching this filter will appear here as they are created.'}</p>
            </div>
          ) : (
            <div className="bl-table-wrap">
              <table className="bl-table">
                <thead>
                  <tr>
                    <th>Bill date</th>
                    <th>Invoice number</th>
                    <th>Patient identifier</th>
                    <th>Patient name</th>
                    <th>Billed items</th>
                    <th className="bl-right">Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(bill => {
                    const chip = STATUS_CHIP[bill.status];
                    return (
                      <tr key={bill._id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatBillDate(bill.createdAt)}</td>
                        <td>
                          <Link href={`/billing/${bill._id}`} className="bl-link">{bill.invoiceNumber}</Link>
                        </td>
                        <td className="bl-num">{bill.hospitalNumber || '—'}</td>
                        <td>{bill.patientName}</td>
                        <td className="bl-muted">
                          {bill.items.length > 0
                            ? bill.items.map(i => i.description).slice(0, 3).join(', ') + (bill.items.length > 3 ? ` +${bill.items.length - 3} more` : '')
                            : '—'}
                        </td>
                        <td className="bl-num bl-right">{formatMoney(bill.totalAmount, { currency: bill.currency })}</td>
                        <td>{chip ? <span className={`bl-chip ${chip.cls}`}>{chip.label}</span> : bill.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="bl-pagination">
              <div className="bl-page-group">
                <span>Items per page:</span>
                <Select
                  value={perPage}
                  aria-label="Items per page"
                  onChange={e => { setPerPage(Number(e.target.value)); setPage(1); }}
                >
                  {PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </Select>
              </div>
              <span>{rangeStart}–{rangeEnd} of {filtered.length} items</span>
              <div className="bl-page-group">
                <Select
                  value={safePage}
                  aria-label="Page"
                  onChange={e => setPage(Number(e.target.value))}
                >
                  {Array.from({ length: pageCount }, (_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}</option>
                  ))}
                </Select>
                <span>of {pageCount} page{pageCount === 1 ? '' : 's'}</span>
                <button
                  type="button"
                  className="bl-pager-btn"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button"
                  className="bl-pager-btn"
                  onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                  disabled={safePage >= pageCount}
                  aria-label="Next page"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
