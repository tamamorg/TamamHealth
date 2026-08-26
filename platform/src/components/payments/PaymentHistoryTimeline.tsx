'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import '@/components/billing/billing.css';
import { useDataScope } from '@/lib/hooks/useDataScope';

interface PaymentHistoryTimelineProps {
  patientId: string;
  limit?: number;
}

interface LedgerEntry {
  _id: string;
  entryType: string;
  amount: number;
  runningBalance: number;
  description: string;
  method?: string;
  currency: string;
  createdAt: string;
}


export default function PaymentHistoryTimeline({ patientId, limit = 20 }: PaymentHistoryTimelineProps) {
  const { t } = useTranslation();
  const scope = useDataScope();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!scope) { setEntries([]); setLoading(false); return; }
    (async () => {
      try {
        const { getPatientLedger } = await import('@/lib/services/ledger-service');
        const data = await getPatientLedger(patientId, limit, scope);
        setEntries(data);
      } catch { /* offline */ }
      setLoading(false);
    })();
  }, [patientId, limit, scope]);

  // Restyled onto the billing module's bl-table — this timeline only ever
  // renders inside BillingTab's "Transaction Ledger" bl-card, so it should
  // read as one more row-striped table, not a bespoke card-free list.
  if (loading) return <div className="bl-muted" style={{ padding: 16, fontSize: 13 }}>{t('payments.loadingHistory')}</div>;
  if (entries.length === 0) {
    return (
      <div className="bl-empty">
        <p>{t('payments.noFinancialHistory')}</p>
      </div>
    );
  }

  return (
    <div className="bl-table-wrap">
      <table className="bl-table">
        <thead>
          <tr><th>Entry</th><th>Date</th><th className="bl-right">Amount</th><th className="bl-right">Balance</th></tr>
        </thead>
        <tbody>
          {entries.map(entry => {
            const isCredit = entry.amount < 0;
            const valueClass = entry.entryType === 'refund' ? '' : isCredit ? 'bl-stat-value--good' : '';
            const date = new Date(entry.createdAt);
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            return (
              <tr key={entry._id}>
                <td>{entry.description}</td>
                <td className="bl-muted" style={{ whiteSpace: 'nowrap' }}>{t('payments.dateAtTime', { date: dateStr, time: timeStr })}</td>
                <td className={`bl-num bl-right ${valueClass}`}>
                  {isCredit ? '-' : '+'}{Math.abs(entry.amount).toLocaleString()} {entry.currency}
                </td>
                <td className="bl-num bl-right bl-muted">{entry.runningBalance.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
