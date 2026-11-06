'use client';

/**
 * Every open alert — disease surveillance, critical lab results, overdue
 * immunizations — in one table drawn like the patient list: the same card,
 * search bar, column head and hairline rows. A row opens the module that
 * works it.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import Select from '@/components/Select';
import { AlertTriangle, FlaskConical, Syringe } from '@/components/icons/lucide';
import { stopsClickPropagation } from '@/lib/a11y';
import { formatShortDate } from '@/lib/format-utils';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuth } from '@/lib/context';

type Severity = 'critical' | 'warning' | 'info';
type AlertCategory = 'surveillance' | 'lab' | 'immunization';
type Translate = (key: string, vars?: Record<string, string | number>) => string;

const SEVERITIES: Severity[] = ['critical', 'warning', 'info'];
const CATEGORIES: AlertCategory[] = ['surveillance', 'lab', 'immunization'];

interface AlertItem {
  id: string;
  severity: Severity;
  category: AlertCategory;
  title: string;
  body: string;
  /** Where it is: a county and state, or the module it came from. */
  place: string;
  placeDetail: string;
  /** One short line under the severity pill (the trend, or what is waiting). */
  note: string;
  timestamp: string; // ISO
  actionLabel: string;
  actionHref: string;
}

const CATEGORY_ICONS = {
  surveillance: AlertTriangle,
  lab: FlaskConical,
  immunization: Syringe,
};

/** Tie-break for alerts raised at the same moment: the more severe first. */
const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

function formatRelative(iso: string, t: Translate): string {
  const time = new Date(iso).getTime();
  if (!time) return '—';
  const diffMin = (Date.now() - time) / 60000;
  if (diffMin < 1) return t('alerts.justNow');
  if (diffMin < 60) return t('alerts.minutesAgo', { count: Math.floor(diffMin) });
  const diffHr = diffMin / 60;
  if (diffHr < 24) return t('alerts.hoursAgo', { count: Math.floor(diffHr) });
  return t('alerts.daysAgo', { count: Math.floor(diffHr / 24) });
}

export default function AlertsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  // Lab and immunization alerts are this facility's own queues.
  const facilityName = currentUser?.hospital?.name || currentUser?.hospitalName || t('alerts.thisFacility');
  const { alerts: diseaseAlerts } = useSurveillance();
  const { immunizations } = useImmunizations();
  const { results: labResults } = useLabResults();
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [category, setCategory] = useState<AlertCategory | ''>('');

  const overdueImmunizations = useMemo(
    () => (immunizations || []).filter(imm => imm.status === 'overdue'),
    [immunizations],
  );
  // Lab results flagged critical and not yet reviewed/finalized.
  const criticalLabResults = useMemo(
    () => (labResults || []).filter(r => r.critical && (r.status === 'pending' || r.status === 'in_progress')),
    [labResults],
  );

  const allAlerts = useMemo<AlertItem[]>(() => {
    const items: AlertItem[] = [];
    const nowIso = new Date().toISOString();

    // Surveillance: emergency + warning
    for (const a of diseaseAlerts) {
      if (a.alertLevel !== 'emergency' && a.alertLevel !== 'warning') continue;
      const sev: Severity = a.alertLevel === 'emergency' ? 'critical' : 'warning';
      const cases = t('alerts.casesCount', { count: a.cases || 0 });
      items.push({
        id: `surv-${a._id}`,
        severity: sev,
        category: 'surveillance',
        title: t(sev === 'critical' ? 'alerts.survOutbreak' : 'alerts.survWarning', { disease: a.disease }),
        body: a.deaths ? `${cases} · ${t('alerts.deathsCount', { count: a.deaths })}` : cases,
        place: a.county || a.state || t('alerts.type.surveillance'),
        placeDetail: a.county ? a.state || '' : '',
        note: a.trend ? t(`alerts.trend.${a.trend}`) : '',
        timestamp: a.reportDate || nowIso,
        actionLabel: t('alerts.openSurveillance'),
        actionHref: '/surveillance',
      });
    }

    if (criticalLabResults.length > 0) {
      items.push({
        id: 'lab-critical',
        severity: 'critical',
        category: 'lab',
        title: t('alerts.labCriticalTitle'),
        body: t('alerts.labCriticalBody', { count: criticalLabResults.length }),
        place: facilityName,
        placeDetail: '',
        note: t('alerts.labCriticalNote'),
        timestamp: nowIso,
        actionLabel: t('alerts.openLab'),
        actionHref: '/lab',
      });
    }

    if (overdueImmunizations.length > 0) {
      items.push({
        id: 'imm-overdue',
        severity: 'info',
        category: 'immunization',
        title: t('alerts.immOverdueTitle'),
        body: t('alerts.immOverdueBody', { count: overdueImmunizations.length }),
        place: facilityName,
        placeDetail: '',
        note: t('alerts.immOverdueNote'),
        timestamp: nowIso,
        actionLabel: t('alerts.openImmunizations'),
        actionHref: '/immunizations',
      });
    }

    // Newest first; within the same moment, the more severe first.
    return items.sort((a, b) =>
      (new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }, [diseaseAlerts, overdueImmunizations, criticalLabResults, facilityName, t]);

  const counts = useMemo(() => ({
    all: allAlerts.length,
    critical: allAlerts.filter(a => a.severity === 'critical').length,
    warning: allAlerts.filter(a => a.severity === 'warning').length,
    info: allAlerts.filter(a => a.severity === 'info').length,
  }), [allAlerts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allAlerts.filter(a =>
      (!severity || a.severity === severity)
      && (!category || a.category === category)
      && (!q || [a.title, a.body, a.place, a.placeDetail].some(v => v.toLowerCase().includes(q))));
  }, [allAlerts, query, severity, category]);

  const activeFilters = (severity ? 1 : 0) + (category ? 1 : 0);

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
        <EhrListHeader
          title={t('ui.allAlerts')}
          count={counts.all}
          stats={[
            { label: t('alerts.severity.critical'), value: counts.critical, color: 'var(--color-danger)' },
            { label: t('alerts.severity.warning'), value: counts.warning, color: 'var(--color-warning-text)' },
            { label: t('alerts.severity.info'), value: counts.info, color: 'var(--accent-primary)' },
          ]}
          search={{
            value: query,
            onChange: setQuery,
            placeholder: t('alerts.searchPlaceholder'),
            filters: {
              activeCount: activeFilters,
              onClear: () => { setSeverity(''); setCategory(''); },
              children: (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('alerts.colSeverity')}</span>
                    <Select value={severity} onChange={e => setSeverity(e.target.value as Severity | '')}>
                      <option value="">{t('alerts.filterAll')}</option>
                      {SEVERITIES.map(s => <option key={s} value={s}>{t(`alerts.severity.${s}`)}</option>)}
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('alerts.colType')}</span>
                    <Select value={category} onChange={e => setCategory(e.target.value as AlertCategory | '')}>
                      <option value="">{t('alerts.filterAll')}</option>
                      {CATEGORIES.map(c => <option key={c} value={c}>{t(`alerts.type.${c}`)}</option>)}
                    </Select>
                  </label>
                </div>
              ),
            },
          }}
        />

        <div className="appointment-card-surface patients-list-surface alerts-list-surface">
          <div className="appointment-card-flow">
            {/* The column head stays when nothing matches (list rule). */}
            <div className="appointment-card-head" aria-hidden="true">
              <span>{t('alerts.colAlert')}</span>
              <span>{t('alerts.colSource')}</span>
              <span>{t('alerts.colType')}</span>
              <span>{t('alerts.colReported')}</span>
              <span>{t('alerts.colSeverity')}</span>
            </div>
            {visible.length === 0 && (
              <div className="appointment-card-empty">
                {allAlerts.length === 0 ? t('alerts.emptyAllClear') : t('alerts.emptyNoMatch')}
              </div>
            )}
            {visible.map(a => {
              const Icon = CATEGORY_ICONS[a.category];
              const open = () => router.push(a.actionHref);
              return (
                <div
                  key={a.id}
                  className="ehr-appointment-row appointment-card-row"
                  role="button"
                  tabIndex={0}
                  onClick={open}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
                >
                  <div className="ehr-appointment-identity">
                    <span className={`alerts-row-plate is-${a.severity}`} aria-hidden="true">
                      <Icon className="w-5 h-5" />
                    </span>
                    <div className="ehr-appointment-main appointment-card-patient">
                      <Link href={a.actionHref} {...stopsClickPropagation}>{a.title}</Link>
                      <p>{a.body}</p>
                    </div>
                  </div>

                  <div className="appointment-card-provider">
                    <strong>{a.place}</strong>
                    {a.placeDetail && <span>{a.placeDetail}</span>}
                  </div>

                  <div className="appointment-card-provider">
                    <strong>{t(`alerts.type.${a.category}`)}</strong>
                    <span>{a.actionLabel}</span>
                  </div>

                  <div className="ehr-appointment-time">
                    <strong>{formatShortDate(a.timestamp, { year: true }) || '—'}</strong>
                    <span>{formatRelative(a.timestamp, t)}</span>
                  </div>

                  <div className="appointment-card-status">
                    <span className={`appointment-status-pill alerts-pill is-${a.severity}`}>
                      {t(`alerts.severity.${a.severity}`)}
                    </span>
                    {a.note && <small>{a.note}</small>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
