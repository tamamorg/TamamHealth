'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import EmptyState from '@/components/EmptyState';
import Badge, { type BadgeTone } from '@/components/Badge';
import {
  AlertTriangle, FlaskConical, Syringe, ChevronRight, CheckCircle2,
} from '@/components/icons/lucide';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { useTranslation } from '@/lib/i18n/useTranslation';

type Severity = 'critical' | 'warning' | 'info';
type AlertCategory = 'surveillance' | 'lab' | 'immunization';

interface AlertItem {
  id: string;
  severity: Severity;
  category: AlertCategory;
  title: string;
  body: string;
  source?: string;
  timestamp: string;            // ISO
  actionLabel: string;
  actionHref: string;
  resolved?: boolean;
}

const SEVERITY_STYLES: Record<Severity, { bg: string; border: string; color: string; label: string }> = {
  critical: {
    bg: 'rgba(196, 69, 54, 0.06)',
    border: 'rgba(196, 69, 54, 0.22)',
    color: 'var(--color-danger)',
    label: 'CRITICAL',
  },
  warning: {
    bg: 'rgba(228, 168, 75, 0.10)',
    border: 'rgba(228, 168, 75, 0.30)',
    color: 'var(--color-warning-text)',
    label: 'WARNING',
  },
  info: {
    bg: 'var(--accent-light)',
    border: 'var(--accent-border)',
    color: 'var(--accent-primary)',
    label: 'INFO',
  },
};

const CATEGORY_ICONS = {
  surveillance: AlertTriangle,
  lab: FlaskConical,
  immunization: Syringe,
};

// Severity → Badge tone for the alert-level pill.
const SEVERITY_TONE: Record<Severity, BadgeTone> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
};

function bucketByRecency(alerts: AlertItem[]) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const recent: AlertItem[] = [];   // last 24h
  const thisWeek: AlertItem[] = []; // 1-7 days
  const earlier: AlertItem[] = [];  // older

  for (const a of alerts) {
    const t = new Date(a.timestamp).getTime() || now;
    const ageDays = (now - t) / day;
    if (ageDays < 1)        recent.push(a);
    else if (ageDays < 7)   thisWeek.push(a);
    else                    earlier.push(a);
  }
  return { recent, thisWeek, earlier };
}

function formatRelative(iso: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const time = new Date(iso).getTime();
  if (!time) return '—';
  const diffMin = (Date.now() - time) / 60000;
  if (diffMin < 1) return t('alerts.justNow');
  if (diffMin < 60) return t('alerts.minutesAgo', { count: Math.floor(diffMin) });
  const diffHr = diffMin / 60;
  if (diffHr < 24) return t('alerts.hoursAgo', { count: Math.floor(diffHr) });
  const diffDay = diffHr / 24;
  if (diffDay < 7) return t('alerts.daysAgo', { count: Math.floor(diffDay) });
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export default function AlertsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { alerts: diseaseAlerts } = useSurveillance();
  const { immunizations } = useImmunizations();
  const { results: labResults } = useLabResults();
  const overdueImmunizations = useMemo(
    () => (immunizations || []).filter(imm => imm.status === 'overdue'),
    [immunizations],
  );
  // Lab results that are flagged critical and not yet reviewed/finalized.
  // Replaces the previous 3%-of-patients fudge with a real PouchDB query.
  const criticalLabResults = useMemo(
    () => (labResults || []).filter(r => r.critical && r.status !== 'completed'),
    [labResults],
  );


  const allAlerts = useMemo<AlertItem[]>(() => {
    const items: AlertItem[] = [];
    const nowIso = new Date().toISOString();

    // Surveillance: emergency + warning
    for (const a of diseaseAlerts) {
      if (a.alertLevel !== 'emergency' && a.alertLevel !== 'warning') continue;
      const sev: Severity = a.alertLevel === 'emergency' ? 'critical' : 'warning';
      items.push({
        id: `surv-${a._id}`,
        severity: sev,
        category: 'surveillance',
        title: `${a.disease} ${sev === 'critical' ? 'outbreak' : 'surveillance warning'}`,
        body: `${a.cases || 0} cases reported${a.deaths ? `, ${a.deaths} deaths` : ''} — trend ${a.trend}`,
        source: [a.county, a.state].filter(Boolean).join(', '),
        timestamp: a.reportDate || nowIso,
        actionLabel: 'Open surveillance',
        actionHref: '/surveillance',
      });
    }

    // Critical lab results — actual count from the lab results store.
    const criticalLabCount = criticalLabResults.length;
    if (criticalLabCount > 0) {
      items.push({
        id: 'lab-critical',
        severity: 'critical',
        category: 'lab',
        title: 'Critical lab results awaiting review',
        body: `${criticalLabCount} result(s) flagged critical and pending clinician sign-off.`,
        source: 'Laboratory',
        timestamp: nowIso,
        actionLabel: 'Review lab queue',
        actionHref: '/lab',
      });
    }

    // Overdue immunizations
    if (overdueImmunizations.length > 0) {
      items.push({
        id: 'imm-overdue',
        severity: 'info',
        category: 'immunization',
        title: 'Overdue immunizations',
        body: `${overdueImmunizations.length} patient(s) past their scheduled vaccination window.`,
        source: 'Immunizations',
        timestamp: nowIso,
        actionLabel: 'Open immunizations',
        actionHref: '/immunizations',
      });
    }

    // Sort newest-first
    return items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [diseaseAlerts, overdueImmunizations, criticalLabResults]);

  const visibleAlerts = allAlerts;

  const buckets = useMemo(() => bucketByRecency(visibleAlerts), [visibleAlerts]);
  const counts = useMemo(() => ({
    all: allAlerts.length,
    critical: allAlerts.filter(a => a.severity === 'critical').length,
    warning: allAlerts.filter(a => a.severity === 'warning').length,
    info: allAlerts.filter(a => a.severity === 'info').length,
  }), [allAlerts]);

  const renderAlertCard = (a: AlertItem) => {
    const styles = SEVERITY_STYLES[a.severity];
    const CatIcon = CATEGORY_ICONS[a.category];
    return (
      <button
        key={a.id}
        onClick={() => router.push(a.actionHref)}
        className="w-full text-left rounded-xl transition-all"
        style={{
          background: styles.bg,
          border: `1px solid ${styles.border}`,
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
        }}
        onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-1px)')}
        onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}
      >
        <div
          className="icon-box flex-shrink-0"
          style={{
            border: `1px solid ${styles.border}`,
            color: styles.color,
          }}
        >
          <CatIcon className="w-4 h-4" style={{ color: styles.color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Badge tone={SEVERITY_TONE[a.severity]} uppercase>
              {styles.label}
            </Badge>
            {a.source && (
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                · {a.source}
              </span>
            )}
            <span className="text-[11px] ml-auto" style={{ color: 'var(--text-muted)' }}>
              {formatRelative(a.timestamp, t)}
            </span>
          </div>
          <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>
            {a.title}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {a.body}
          </p>
          <div className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: styles.color }}>
            {a.actionLabel}
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </button>
    );
  };

  const renderSection = (title: string, items: AlertItem[]) => {
    if (items.length === 0) return null;
    return (
      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {title}
          </h3>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {items.length}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {items.map(renderAlertCard)}
        </div>
      </section>
    );
  };

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
        <EhrListHeader
          title="All alerts"
          stats={[
            { label: 'Total',    value: counts.all,      color: 'var(--text-muted)' },
            { label: 'Critical', value: counts.critical, color: 'var(--color-danger)' },
            { label: 'Warning',  value: counts.warning,  color: 'var(--color-warning-text)' },
            { label: 'Info',     value: counts.info,     color: 'var(--accent-primary)' },
          ]}
        />

        {/* Alerts feed */}
        <div data-tour="alerts-feed" style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: 16 }}>
          {visibleAlerts.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="All clear"
              message="No active clinical alerts. We will notify you the moment something needs attention."
            />
          ) : (
            <>
              {renderSection('Recent · last 24 hours', buckets.recent)}
              {renderSection('Earlier this week', buckets.thisWeek)}
              {renderSection('Older', buckets.earlier)}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
