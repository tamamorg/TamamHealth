'use client';

/**
 * Super-admin → Data Governance.
 * MPI duplicate review, facility completeness, and validity scanning —
 * everything computed client-side from the real patient/hospital stores on
 * a single load. No fabricated counts: every number here is derived from
 * getAllPatients()/useHospitals() or the conflicts API.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  SadbPage, SadbCard, SadbChip, SadbKvRow, SadbShell, SadbPanelHeader, useSadbTab,
} from '@/components/admin/sadb-ui';
import { SaTable } from '@/components/admin/sa-ui';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { apiFetch } from '@/lib/api-fetch';
import DuplicateReviewPanel from '@/components/patients/DuplicateReviewPanel';
import { useDuplicateReview } from '@/components/patients/useDuplicateReview';
import { ArrowRight, Copy, BarChart3, AlertTriangle, GitCompareArrows } from '@/components/icons/lucide';
import { useNow } from '@/lib/hooks/useNow';
import { useTranslation } from '@/lib/i18n/useTranslation';

const ROW_CAP = 50;

export default function AdminDataGovernancePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { hospitals, loading: hospitalsLoading } = useHospitals();
  // The duplicate review itself lives in DuplicateReviewPanel, shared with
  // /data-quality (the page every org-level records role can open). This page
  // keeps the review for the platform operator and reads the same scan for the
  // other sections.
  const review = useDuplicateReview();
  const { patients } = review;
  const loading = review.loading;
  const [pendingConflicts, setPendingConflicts] = useState<number | null>(null);
  const [conflictsError, setConflictsError] = useState(false);

  // Section switching is now URL-backed (?tab=) so every section is
  // deep-linkable, replacing the old page-local saside rail.
  const [activeSection, setActiveSection] = useSadbTab('duplicates');

  const loadConflicts = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/conflicts?status=pending');
      if (!res.ok) { setConflictsError(true); return; }
      const body = await res.json();
      setPendingConflicts(Array.isArray(body.conflicts) ? body.conflicts.length : 0);
      setConflictsError(false);
    } catch {
      setConflictsError(true);
    }
  }, []);

  useEffect(() => { loadConflicts(); }, [loadConflicts]);

  // ── Missing / invalid value scan ──
  // The clock is an input, not something read mid-render: see useNow.
  const now = useNow();
  const validity = useMemo(() => {
    let missingDob = 0;
    let missingGender = 0;
    let missingPhone = 0;
    let futureDob = 0;
    let missingAny = 0;

    for (const p of patients) {
      let missing = false;
      if (!p.dateOfBirth) { missingDob++; missing = true; }
      else {
        const d = new Date(p.dateOfBirth).getTime();
        if (!Number.isNaN(d) && d > now) futureDob++;
      }
      if (!p.gender) { missingGender++; missing = true; }
      if (!p.phone) { missingPhone++; missing = true; }
      if (missing) missingAny++;
    }

    return { missingDob, missingGender, missingPhone, futureDob, missingAny };
  }, [patients, now]);

  // ── Completeness by facility ──
  const completeness = useMemo(() => {
    const byHospital = new Map<string, typeof patients>();
    for (const p of patients) {
      const hid = p.registrationHospital;
      if (!hid) continue;
      const arr = byHospital.get(hid) || [];
      arr.push(p);
      byHospital.set(hid, arr);
    }

    const rows = hospitals
      .map(h => {
        const list = byHospital.get(h._id) || [];
        const complete = list.filter(p => !!p.dateOfBirth && !!p.gender && !!p.phone).length;
        const score = list.length > 0 ? Math.round((complete / list.length) * 100) : null;
        return { hospitalId: h._id, name: h.name, total: list.length, complete, score };
      })
      .filter(r => r.total > 0)
      .sort((a, b) => (a.score ?? 100) - (b.score ?? 100));

    const belowThreshold = rows.filter(r => r.score !== null && r.score < 80).length;
    return { rows, belowThreshold };
  }, [patients, hospitals]);

  const busy = loading || hospitalsLoading;

  const railGroups = [{
    title: t('adminMgmt.dataChecks'),
    items: [
      { id: 'duplicates', label: t('adminMgmt.duplicateReview'), icon: Copy, count: busy ? '…' : review.candidates.length },
      { id: 'completeness', label: t('dataQuality.thCompleteness'), icon: BarChart3, count: busy ? '…' : completeness.rows.length },
      { id: 'invalid', label: t('adminMgmt.invalidValues'), icon: AlertTriangle, count: validity.missingAny },
      { id: 'reconciliation', label: t('msg.movement.reconciliation'), icon: GitCompareArrows, count: conflictsError ? 0 : pendingConflicts ?? '…' },
    ],
  }];

  return (
    <SadbPage>
      <SadbShell groups={railGroups} active={activeSection} onSelect={setActiveSection}>
        {activeSection === 'duplicates' && (
          <>
            <DuplicateReviewPanel review={review} />
          </>
        )}

        {activeSection === 'completeness' && (
          <>
            <SadbPanelHeader
              title={t('ui.dataCompletenessByFacility')}
              note={t('adminMgmt.completenessNote')}
              tag={busy ? undefined : (completeness.belowThreshold > 0 ? t('adminMgmt.nBelow80', { count: completeness.belowThreshold }) : t('adminMgmt.allFacilitiesOk'))}
              tagTone={busy ? undefined : (completeness.belowThreshold > 0 ? 'red' : 'green')}
            />
            <SadbCard meta={busy ? undefined : t('adminMgmt.nFacilitiesWithPatients', { count: completeness.rows.length })}>
              <SaTable
                columns={[
                  { label: t('births.colFacility'), w: 2.2 }, { label: t('admin.dbPatients'), w: 0.9 },
                  { label: t('rxFlow.actionComplete'), w: 0.9 }, { label: t('assessments.scoreLabel'), w: 0.9 },
                ]}
                empty={busy ? t('admin.loading') : t('adminMgmt.noFacilitiesWithPatients')}
                minWidth={520}
              >
                {completeness.rows.slice(0, ROW_CAP).map(r => (
                  <tr key={r.hospitalId}>
                    <td><strong>{r.name}</strong></td>
                    <td className="sa-num">{r.total}</td>
                    <td className="sa-num">{r.complete}</td>
                    <td className="sa-num">
                      <SadbChip tone={r.score! >= 90 ? 'green' : r.score! >= 70 ? 'yellow' : 'red'}>{r.score}%</SadbChip>
                    </td>
                  </tr>
                ))}
              </SaTable>
              {!busy && completeness.rows.length > ROW_CAP && (
                <p className="sadb-card-meta" style={{ padding: '10px 14px', margin: 0, borderTop: '1px solid var(--border-light)' }}>
                  {t('adminMgmt.showingFirstOf', { cap: ROW_CAP, total: completeness.rows.length })}
                </p>
              )}
            </SadbCard>
          </>
        )}

        {activeSection === 'invalid' && (
          <>
            <SadbPanelHeader
              title={t('ui.invalidMissingValues')}
              note={t('adminMgmt.invalidNote')}
              tag={busy ? undefined : (validity.missingAny > 0 ? t('adminMgmt.nFlagged', { count: validity.missingAny }) : t('adminMgmt.noIssuesFound'))}
              tagTone={busy ? undefined : (validity.missingAny > 0 ? 'yellow' : 'green')}
            />
            <SadbCard meta={busy ? undefined : t('adminMgmt.nRecordsScanned', { count: patients.length.toLocaleString() })}>
              <SadbKvRow label={t('ui.missingDateOfBirth')} value={busy ? '—' : validity.missingDob} />
              <SadbKvRow label={t('ui.missingGender')} value={busy ? '—' : validity.missingGender} />
              <SadbKvRow label={t('ui.missingPhone')} value={busy ? '—' : validity.missingPhone} />
              <SadbKvRow label={t('ui.futureDateOfBirth')} value={busy ? '—' : validity.futureDob} />
            </SadbCard>
          </>
        )}

        {activeSection === 'reconciliation' && (
          <>
            <SadbPanelHeader
              title={t('ui.reconciliationRequests')}
              note={t('adminMgmt.reconNote')}
              tag={conflictsError ? t('adminMgmt.unavailable') : (busy ? undefined : ((pendingConflicts ?? 0) > 0 ? t('adminMgmt.nPending', { count: pendingConflicts ?? 0 }) : t('action.clear')))}
              tagTone={conflictsError ? 'neutral' : ((pendingConflicts ?? 0) > 0 ? 'red' : 'green')}
            />
            <SadbCard>
              <SadbKvRow
                label={t('ui.pendingSyncConflicts')}
                value={conflictsError ? '—' : pendingConflicts ?? '…'}
                valueTone={!conflictsError && (pendingConflicts ?? 0) > 0 ? 'warn' : undefined}
              />
              <div style={{ padding: '0 14px 14px' }}>
                <button type="button" className="tm-ghost-btn" onClick={() => router.push('/admin/conflicts')}>
                  {t('ui.openReconciliationQueue')}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
              <div className="sadb-kv">
                <span>{t('ui.exportDeletionRequests')}</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{t('adminMgmt.exportDeletionNone')}</span>
              </div>
              <div style={{ padding: '14px 14px 0' }}>
                <button type="button" className="tm-ghost-btn" onClick={() => router.push('/admin/security')}>
                  {t('ui.reviewDataPolicy')}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </SadbCard>
          </>
        )}
      </SadbShell>
    </SadbPage>
  );
}
