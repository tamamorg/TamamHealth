'use client';

/**
 * Report a problem — open to every signed-in role (`/report-issue`).
 *
 * The form files a staff issue report (issue-report-service); below it the
 * reporter sees what they have filed, its status, and the administrators'
 * response, so a report is never a message into a void. Reports reach the
 * same people who triage patient inquiries, on the `Reported issues` tab.
 */

import { useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import Select from '@/components/Select';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { messagesDB } from '@/lib/db';
import type { MessageDoc } from '@/lib/db-types';
import { formatCompactDateTime } from '@/lib/format-utils';
import { usePouchLiveReload } from '@/lib/hooks/usePouchLiveReload';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  DETAILS_MAX, ISSUE_CATEGORIES, ISSUE_SEVERITIES, SUMMARY_MAX,
  deriveIssueStatus, sanitiseIssuePage,
  type IssueCategory, type IssueSeverity,
} from '../issue-rules';
import { ISSUE_STATUS_TOKENS } from './issue-status-tokens';

const labelClass = 'field-required text-xs font-semibold uppercase tracking-wider mb-1 block';
const labelStyle = { color: 'var(--text-muted)' } as const;

export default function ReportIssueScreen() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const fromPage = sanitiseIssuePage(searchParams?.get('from'));

  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [category, setCategory] = useState<IssueCategory>('bug');
  const [severity, setSeverity] = useState<IssueSeverity>('medium');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [mine, setMine] = useState<MessageDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const userId = currentUser?._id;
  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const { getMyIssueReports } = await import('../services/issue-report-service');
      setMine(await getMyIssueReports(userId));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // An administrator's status change or response arrives by replication.
  usePouchLiveReload<MessageDoc>({
    load,
    database: messagesDB,
    includeDocs: true,
    shouldReload: change => !change.doc || change.doc.messageKind === 'issue_report',
    enabled: !!userId,
  });

  const submit = async () => {
    if (!currentUser || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const { createIssueReport } = await import('../services/issue-report-service');
      await createIssueReport(
        { summary, details, category, severity, page: fromPage },
        {
          id: currentUser._id,
          name: currentUser.name,
          role: currentUser.role,
          hospitalId: currentUser.hospitalId,
          hospitalName: currentUser.hospitalName,
          orgId: currentUser.orgId,
        },
      );
      setSummary('');
      setDetails('');
      setCategory('bug');
      setSeverity('medium');
      showToast(t('issues.sent'), 'success');
      await load();
    } catch (err) {
      // A validation message is written for the reporter; anything else is not.
      setFormError(err instanceof Error && err.name === 'IssueReportValidationError' ? err.message : t('issues.sendFailed'));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && summary.trim().length > 0 && details.trim().length > 0;

  return (
    <main className="page-container page-enter">
      <div className="dash-card overflow-hidden mb-4">
        <EhrListHeader title={t('issues.reportTitle')} />
        <div className="p-5 space-y-4" style={{ maxWidth: 760 }}>
          <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>{t('issues.reportIntro')}</p>

          <div>
            <label htmlFor="issue-summary" className={labelClass} style={labelStyle}>{t('issues.summaryLabel')}</label>
            <input
              id="issue-summary"
              value={summary}
              maxLength={SUMMARY_MAX}
              onChange={e => setSummary(e.target.value)}
              placeholder={t('issues.summaryPlaceholder')}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="issue-category" className={labelClass} style={labelStyle}>{t('issues.categoryLabel')}</label>
              <Select id="issue-category" value={category} onChange={e => setCategory(e.target.value as IssueCategory)} className="w-full">
                {ISSUE_CATEGORIES.map(c => <option key={c} value={c}>{t(`issues.category.${c}`)}</option>)}
              </Select>
            </div>
            <div>
              <label htmlFor="issue-severity" className={labelClass} style={labelStyle}>{t('issues.severityLabel')}</label>
              <Select id="issue-severity" value={severity} onChange={e => setSeverity(e.target.value as IssueSeverity)} className="w-full">
                {ISSUE_SEVERITIES.map(s => <option key={s} value={s}>{t(`issues.severity.${s}`)}</option>)}
              </Select>
            </div>
          </div>

          <div>
            <label htmlFor="issue-details" className={labelClass} style={labelStyle}>{t('issues.detailsLabel')}</label>
            <textarea
              id="issue-details"
              rows={6}
              value={details}
              maxLength={DETAILS_MAX}
              onChange={e => setDetails(e.target.value)}
              placeholder={t('issues.detailsPlaceholder')}
            />
            <p className="text-[11.5px] mt-1" style={{ color: 'var(--text-muted)' }}>{t('issues.noPatientNames')}</p>
          </div>

          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {`${t('issues.pageLabel')}: ${fromPage || t('issues.pageNone')}`}
          </p>

          {formError && <p role="alert" className="text-[12.5px]" style={{ color: 'var(--color-danger-text)' }}>{formError}</p>}

          <div className="flex justify-end">
            <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={() => void submit()}>
              {busy ? t('issues.sending') : t('issues.submit')}
            </button>
          </div>
        </div>
      </div>

      <div className="dash-card overflow-hidden">
        <EhrListHeader title={t('issues.myReports')} count={mine.length} />
        <div className="p-5 space-y-3">
          {loading && <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{t('issues.loading')}</p>}
          {!loading && loadFailed && (
            <div className="flex items-center gap-3">
              <p className="text-[13px]" style={{ color: 'var(--color-danger-text)' }}>{t('issues.loadFailed')}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>{t('issues.retry')}</button>
            </div>
          )}
          {!loading && !loadFailed && mine.length === 0 && (
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>{t('issues.myReportsEmpty')}</p>
          )}
          {!loading && !loadFailed && mine.map(report => {
            const status = deriveIssueStatus(report);
            const tok = ISSUE_STATUS_TOKENS[status];
            const meta = [
              report.issueCategory ? t(`issues.category.${report.issueCategory}`) : null,
              report.issueSeverity ? t(`issues.severity.${report.issueSeverity}`) : null,
              formatCompactDateTime(report.sentAt || report.createdAt),
            ].filter(Boolean).join(' · ');
            return (
              <article key={report._id} className="rounded-lg p-4" style={{ border: '1px solid var(--border-light)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="text-[14px] block" style={{ color: 'var(--text-primary)' }}>{report.subject}</strong>
                    <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{meta}</span>
                  </div>
                  <span
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ color: tok.color, background: tok.bg, border: `1px solid ${tok.border}` }}
                  >
                    {t(`issues.status.${status}`)}
                  </span>
                </div>
                <p className="text-[13px] mt-2 whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{report.body}</p>
                <div className="mt-3 rounded-md p-3" style={{ background: 'var(--overlay-subtle)' }}>
                  <span className="text-[11px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('issues.response')}</span>
                  <p className="text-[13px] mt-0.5 whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>
                    {report.issueResolutionNote || t('issues.awaitingResponse')}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
