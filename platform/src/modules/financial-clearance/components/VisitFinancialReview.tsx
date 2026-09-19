'use client';

import { useEffect, useState, useId } from 'react';
import Link from 'next/link';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { RefreshCw } from '@/components/icons/lucide';
import type { VisitFinancialEvidence } from '../evidence';
import styles from './VisitFinancialReview.module.css';

type Visit = VisitFinancialEvidence & { startedAt: string };

export function VisitFinancialReview({ patientId, encounterId }: { patientId: string; encounterId?: string }) {
  const { t } = useTranslation();
  const scope = useDataScope();
  const selectId = useId();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [selected, setSelected] = useState(encounterId ?? '');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (!scope) { setLoading(false); setFailed(true); setVisits([]); return; }
      setLoading(true);
      try {
        const { getPatientVisitFinancialEvidence } = await import('../services/evidence-service');
        const result = await getPatientVisitFinancialEvidence(patientId, scope);
        if (active) { setVisits(result); setFailed(false); }
      } catch {
        if (active) { setVisits([]); setFailed(true); }
      } finally {
        if (active) {
          setLoading(false);
          timer = setTimeout(load, 15000);
        }
      }
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [patientId, scope, refresh]);

  const visit = visits.find(item => item.encounterId === selected) ?? visits[0];
  const status = visit?.status ?? 'not_reviewed';
  return (
    <section className={styles.review} aria-labelledby={`${selectId}-title`}>
      <div className={styles.heading}>
        <div>
          <h3 id={`${selectId}-title`}>{t('financialReview.title')}</h3>
          <p>{t('financialReview.help')}</p>
        </div>
        <button type="button" className={styles.refresh} onClick={() => setRefresh(value => value + 1)} disabled={loading} aria-label={t('financialReview.refresh')}>
          <RefreshCw size={18} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.selection}>
        <label htmlFor={selectId}>{t('financialReview.visit')}</label>
        <select id={selectId} value={visit?.encounterId ?? ''} onChange={event => setSelected(event.target.value)} disabled={!visits.length}>
          {!visits.length && <option value="">{t('financialReview.noVisit')}</option>}
          {visits.map(item => <option key={item.encounterId} value={item.encounterId}>{new Date(item.startedAt).toLocaleString()} — {item.encounterId}</option>)}
        </select>
        <span className={styles.status} data-status={loading || failed ? 'not_reviewed' : status} role="status">
          {t(loading ? 'financialReview.loading' : failed ? 'financialReview.unavailable' : `financialReview.${status}`)}
        </span>
      </div>
      {failed ? <p role="alert">{t('financialReview.error')}</p> : !loading && (
        <>
          <p>{t(`financialReview.next.${status}`)}</p>
          {!!visit?.invoices.length && <div className={styles.tableWrap}>
            <table>
              <thead><tr>
                <th>{t('financialReview.invoice')}</th><th>{t('financialReview.amount')}</th>
                <th>{t('financialReview.paid')}</th><th>{t('financialReview.due')}</th><th>{t('financialReview.status')}</th>
              </tr></thead>
              <tbody>{visit.invoices.map(invoice => <tr key={invoice.billId}>
                <td><Link href={`/billing/${encodeURIComponent(invoice.billId)}`}>{invoice.invoiceNumber}</Link></td>
                <td>{invoice.currency} {invoice.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td>{invoice.currency} {invoice.paid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td>{invoice.currency} {invoice.due.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td>{t(`financialReview.${invoice.status}`)}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        </>
      )}
      <p className={styles.safety}>{t('financialReview.safety')}</p>
    </section>
  );
}
