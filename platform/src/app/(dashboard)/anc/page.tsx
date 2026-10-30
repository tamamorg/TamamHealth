'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import EmptyState from '@/components/EmptyState';
import Badge, { type BadgeTone } from '@/components/Badge';
import { useANC } from '@/lib/hooks/useANC';
import { useAuth, useUi } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useTranslation } from '@/lib/i18n/useTranslation';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import AncVisitForm from '@/components/anc/AncVisitForm';
import { HeartPulse, Plus, ChevronRight } from '@/components/icons/lucide';
import { toIsoDate, todayIso } from '@/lib/date-utils';

const riskColors: Record<'low' | 'moderate' | 'high', { tone: BadgeTone; label: string }> = {
  low: { tone: 'info', label: 'Low Risk' },
  moderate: { tone: 'warning', label: 'Moderate' },
  high: { tone: 'danger', label: 'High Risk' },
};

export default function ANCPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { globalSearch } = useUi();
  const { visits, stats, loading } = useANC();
  const { canRecordVitalEvents } = usePermissions();
  // Programme analytics (summary cards + ANC continuum funnel) are a population
  // view for facility management and the Ministry of Health. Clinical roles keep
  // the data recordings, workflow, and the mother/visit data.
  const canViewCoverage = ['hospital_manager', 'medical_superintendent', 'government', 'county_health_director', 'super_admin'].includes(currentUser?.role ?? '');
  // Table toolbar search (shared list-page header), combined with the
  // platform-wide search bar so a term typed elsewhere still narrows this list.
  const [tableSearch, setTableSearch] = useState('');
  const search = `${tableSearch} ${globalSearch}`.trim();
  const [showModal, setShowModal] = useState(false);
  const closeRegistrationForm = () => setShowModal(false);
  // Correcting a saved visit happens in the mother's chart (Antenatal care,
  // AncVisitEditor); this page is the register of mothers. The form is a
  // slider beside the list, so the page behind it is not scroll-locked.

  // Group visits by mother — get latest visit for each
  const motherSummaries = useMemo(() => {
    const map = new Map<string, { latest: typeof visits[0]; visitCount: number; allVisits: typeof visits }>();
    for (const v of (visits || [])) {
      const existing = map.get(v.motherId);
      if (!existing) {
        map.set(v.motherId, { latest: v, visitCount: 1, allVisits: [v] });
      } else {
        existing.visitCount++;
        existing.allVisits.push(v);
        if (v.visitNumber > existing.latest.visitNumber) existing.latest = v;
      }
    }
    return Array.from(map.values());
  }, [visits]);

  const filteredMothers = useMemo(() => {
    let result = motherSummaries;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(m => m.latest.motherName.toLowerCase().includes(q));
    }
    return result;
  }, [motherSummaries, search]);

  // Header stat chips — computed from data already loaded on this page (no
  // extra fetches). Unaffected by the search box, same as the patients header.
  const today = todayIso();
  const thisMonthPrefix = today.slice(0, 7);
  const highRiskCount = useMemo(() => motherSummaries.filter(m => m.latest.riskLevel === 'high').length, [motherSummaries]);
  const visitsThisMonth = useMemo(() => (visits || []).filter(v => v.visitDate?.startsWith(thisMonthPrefix)).length, [visits, thisMonthPrefix]);
  const dueSoonCount = useMemo(() => {
    const in7 = new Date();
    in7.setDate(in7.getDate() + 7);
    const in7Str = toIsoDate(in7);
    return motherSummaries.filter(m => m.latest.nextVisitDate && m.latest.nextVisitDate >= today && m.latest.nextVisitDate <= in7Str).length;
  }, [motherSummaries, today]);

  if (loading) {
    return (
      <main className="page-container page-enter">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('anc.loadingRecords')}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page-container page-enter">
        {/* Continuum funnel */}
        {canViewCoverage && stats && stats.continuum && stats.totalMothers > 0 && (
          <div className="card-elevated p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <HeartPulse className="w-4 h-4" style={{ color: 'var(--chart-2)' }} />
                <h3 className="font-semibold text-sm">{t('anc.continuumTitle')}</h3>
              </div>
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>
                {t('anc.who8ContactModel')}
              </span>
            </div>
            <div className="space-y-2">
              {([
                { key: 'anc1', label: t('anc.anc1Label'), count: stats.continuum.anc1 },
                { key: 'anc2', label: t('anc.anc2Label'), count: stats.continuum.anc2 },
                { key: 'anc3', label: t('anc.anc3Label'), count: stats.continuum.anc3 },
                { key: 'anc4', label: t('anc.anc4Label'), count: stats.continuum.anc4 },
                { key: 'anc5plus', label: t('anc.anc5plusLabel'), count: stats.continuum.anc5plus },
              ] as const).map((step, i) => {
                const pct = stats.totalMothers > 0 ? Math.round((step.count / stats.totalMothers) * 100) : 0;
                const dropoff = i > 0 ? Math.max(0, ([stats.continuum.anc1, stats.continuum.anc2, stats.continuum.anc3, stats.continuum.anc4, stats.continuum.anc5plus][i - 1]) - step.count) : 0;
                const barColor = step.key === 'anc4' ? 'var(--accent-primary)' : pct >= 50 ? 'var(--accent-hover)' : pct >= 25 ? 'var(--color-warning)' : 'var(--color-danger)';
                return (
                  <div key={step.key} className="flex items-center gap-3">
                    <span className="text-xs font-bold w-44 text-end" style={{ color: 'var(--text-secondary)' }}>{step.label}</span>
                    <div className="flex-1 h-7 rounded-md overflow-hidden" style={{ background: 'var(--overlay-light)' }}>
                      <div
                        className="h-full rounded-md flex items-center justify-end pe-2 transition-all duration-700"
                        style={{ width: `${Math.max(pct, 4)}%`, background: barColor }}
                      >
                        <span className="text-[10px] font-bold text-white">{step.count} ({pct}%)</span>
                      </div>
                    </div>
                    {i > 0 && dropoff > 0 ? (
                      <span className="text-[10px] font-mono w-16 text-end" style={{ color: 'var(--color-danger-text)' }}>{t('anc.dropCount', { count: dropoff })}</span>
                    ) : (
                      <span className="text-[10px] w-16" />
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] mt-3 pt-3 border-t" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-light)' }}>
              {t('anc.continuumNote')}
            </p>
          </div>
        )}

        {/* The register is the list of mothers; each opens her own chart at
            Antenatal care, where the visits, birth plan and corrections live. */}
        <div>
          <div className="card-elevated overflow-hidden">
            <EhrListHeader
              title={t('anc.title')}
              count={motherSummaries.length}
              stats={[
                { label: 'High risk', value: highRiskCount, color: LIST_STAT_COLORS.blue },
                { label: 'Visits this month', value: visitsThisMonth, color: LIST_STAT_COLORS.amber },
                { label: 'Due soon', value: dueSoonCount, color: LIST_STAT_COLORS.green },
              ]}
              search={{ value: tableSearch, onChange: setTableSearch, placeholder: 'Search mothers by name…', ariaLabel: 'Search mothers by name' }}
              actions={
                canRecordVitalEvents && (
                  <button onClick={() => setShowModal(true)} className="btn btn-primary" style={{ gap: 8, height: 38, whiteSpace: 'nowrap' }}>
                    <Plus className="w-4 h-4" /> {t('anc.registerVisit')}
                  </button>
                )
              }
            />

            <div className="divide-y data-row-divider-sm" style={{ borderColor: 'var(--table-row-border)' }}>
              {filteredMothers.map(({ latest, visitCount }) => {
                const risk = riskColors[latest.riskLevel] || riskColors.low;
                const hasRealPatientRecord = !!latest.motherId
                  && !latest.motherId.startsWith('demo-')
                  && !latest.motherId.startsWith('mother-new-')
                  && !latest.motherId.includes('_demo');
                const chartHref = `/patients/${encodeURIComponent(latest.motherId)}?tab=anc`;
                const open = () => { if (hasRealPatientRecord) router.push(chartHref); };
                return (
                  <div
                    key={latest.motherId}
                    {...(hasRealPatientRecord ? {
                      role: 'link',
                      tabIndex: 0,
                      'aria-label': t('ancChart.openChart', { name: latest.motherName }),
                      onClick: open,
                      onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } },
                    } : {})}
                    className={`flex items-center gap-3 px-4 py-3 transition-colors ${hasRealPatientRecord ? 'cursor-pointer hover:bg-[var(--table-row-hover)]' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{latest.motherName}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {t('anc.motherMeta', { age: latest.motherAge, gravida: latest.gravida, parity: latest.parity, weeks: latest.gestationalAge, facility: latest.facilityName })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <Badge tone={risk.tone}>{risk.label}</Badge>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {visitCount} visit{visitCount !== 1 ? 's' : ''}
                      </span>
                      {hasRealPatientRecord
                        ? <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} aria-hidden />
                        : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('ancChart.noRecord')}</span>}
                    </div>
                  </div>
                );
              })}
              {filteredMothers.length === 0 && (
                <EmptyState
                  icon={HeartPulse}
                  title={search ? 'No matching mothers' : 'No ANC visits yet'}
                  message={search
                    ? 'Try a different search term, or clear the search to see all enrolled mothers.'
                    : 'Start enrolling pregnant mothers in antenatal care. Track gestational age, vitals, risk factors, and birth plans across all 8 WHO-recommended visits.'}
                  action={!search && canRecordVitalEvents ? { label: 'Register ANC visit', onClick: () => setShowModal(true) } : undefined}
                />
              )}
            </div>
          </div>
        </div>

        {/* Registration form — shared with the patient chart's workspace. */}
        {showModal && (
          <AncVisitForm layout="slider" onClose={closeRegistrationForm} />
        )}

    </main>
  );
}
