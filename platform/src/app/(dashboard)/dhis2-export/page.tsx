'use client';

import { todayIso } from '@/lib/date-utils';
import { useState, useEffect, useMemo } from 'react';
import InlineBanner from '@/components/overlay/InlineBanner';
import { SadbKpiTile } from '@/components/admin/sadb-ui';
import './dhis2-export.css';
import {
  RefreshCw, CheckCircle, Clock,
  Download, FileJson, FileSpreadsheet, Loader2,
  Database, FileText, BarChart3,
} from '@/components/icons/lucide';
import { usePatients } from '@/lib/hooks/usePatients';
import { useSurveillance } from '@/lib/hooks/useSurveillance';
import { useImmunizations } from '@/lib/hooks/useImmunizations';
import { useANC } from '@/lib/hooks/useANC';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { downloadFile, safeFilenamePart } from '@/lib/export-file';
import {
  getDhis2SyncLog, recordDhis2SyncResult, appendDhis2LogEntry,
  isDhis2Configured, getDhis2BaseUrlHost, groupDhis2DataValues, getMetric,
  type Dhis2SyncLogDoc,
} from '@/lib/services/dhis2-sync-log-service';
import Select from '@/components/Select';
import { useUrlView } from '@/lib/navigation/use-url-view';

// ── HMIS report catalog (South Sudan standard report names/cadence). This is
// structural metadata, not per-record data — the completeness/status shown
// for each is derived from the real, persisted sync log below, not fabricated
// per report. ──
const REPORT_TYPES = [
  { name: 'Monthly HMIS Report (105)' },
  { name: 'Weekly Epidemiological Report' },
  { name: 'Quarterly HIV Report' },
  { name: 'Monthly Maternal Health' },
  { name: 'Immunization Coverage Report' },
];

export default function DHIS2ExportPage() {
  const { t } = useTranslation();
  // In the URL (?view=) so Back returns to the tab the user was on.
  const [activeTab, setActiveTab] = useUrlView(['overview', 'reports', 'aggregate', 'export', 'log'] as const, 'overview');
  const [syncing, setSyncing] = useState(false);
  const [period, setPeriod] = useState(todayIso().slice(0, 7));
  const [exportLevel, setExportLevel] = useState<'facility' | 'payam' | 'county' | 'state' | 'national'>('facility');
  const [exporting, setExporting] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exportResult, setExportResult] = useState<{ format: string; rows: number; date: string } | null>(null);
  // Persisted sync state (last push, dataset snapshot, history) — replaces the
  // fabricated per-element statuses and seeded log lines this page used to show.
  const [log, setLog] = useState<Dhis2SyncLogDoc | null>(null);
  useEffect(() => {
    getDhis2SyncLog().then(setLog).catch(() => setLog(null));
  }, []);

  const { patients } = usePatients();
  const { alerts: diseaseAlerts } = useSurveillance();
  const { stats: immStats } = useImmunizations();
  const { stats: ancStats } = useANC();
  const { currentUser } = useAuth();

  const hospitalName = currentUser?.hospital?.name || currentUser?.hospitalName || '';

  // Everything below derives from the REAL persisted log — honest empty states
  // ("Never synced", "Not configured") when nothing has run yet.
  const dhis2Configured = isDhis2Configured();
  const dhis2Host = getDhis2BaseUrlHost();
  const lastPushSucceeded = log?.lastPush?.status === 'pushed';
  const snapshotValues = log?.lastDataset?.dataValues;
  const elementGroups = useMemo(() => (snapshotValues ? groupDhis2DataValues(snapshotValues) : []), [snapshotValues]);
  const elementCount = snapshotValues?.length ?? 0;
  const lastSyncedLabel = log?.lastSyncedAt ? new Date(log.lastSyncedAt).toLocaleString() : null;
  const lastSyncShort = log?.lastSyncedAt ? new Date(log.lastSyncedAt).toLocaleDateString() : '—';
  const reportCompleteness = getMetric(snapshotValues, 'REPORTING_COMPLETENESS') ?? getMetric(snapshotValues, 'DATA_QUALITY_SCORE') ?? (lastPushSucceeded ? 100 : 0);
  // `lastDataset.period` is persisted normalized (dash-stripped by
  // normalizeDhis2Period, e.g. "202607"); the picker holds "YYYY-MM". Compare
  // against the same normalized form, else this is always false and the
  // "reports submitted" state never triggers.
  const reportsSubmitted = lastPushSucceeded && log?.lastDataset?.period === period.replace(/-/g, '');

  // Resolve which tier of data to export. Each option picks the field(s) that
  // anchor the scope; the service derives the orgUnit from those.
  const buildExportScope = (): { hospitalId?: string; orgId?: string; payam?: string; county?: string; state?: string; role: string } | undefined => {
    if (!currentUser) return undefined;
    const base = { role: currentUser.role, orgId: currentUser.orgId };
    const u = currentUser as unknown as { payam?: string; county?: string; state?: string };
    switch (exportLevel) {
      case 'facility': return { ...base, hospitalId: currentUser.hospitalId };
      case 'payam':    return { ...base, payam: u.payam };
      case 'county':   return { ...base, county: u.county };
      case 'state':    return { ...base, state: u.state };
      case 'national': return { role: currentUser.role };
    }
  };
  const nationalAllowed = currentUser?.role === 'super_admin' || currentUser?.role === 'government';
  const u = currentUser as unknown as { payam?: string; county?: string; state?: string } | null;

  const handleSync = async () => {
    setSyncing(true);
    setSyncError('');
    try {
      const initiated = await appendDhis2LogEntry(t('dhis2.logInitiatingSync'), 'info');
      setLog(initiated);
      const { generateDHIS2Export, pushDataSetToDHIS2 } = await import('@/lib/services/dhis2-export-service');
      const dataset = await generateDHIS2Export(period, buildExportScope());
      const result = await pushDataSetToDHIS2(dataset);
      // Persist the attempt (entry + lastPush + dataset snapshot); only a real
      // successful push advances lastSyncedAt.
      const updated = await recordDhis2SyncResult({ dataset, push: result });
      setLog(updated);
    } catch (err) {
      const updated = await appendDhis2LogEntry(t('dhis2.logSyncFailed', { msg: (err as Error).message }), 'error').catch(() => null);
      if (updated) setLog(updated);
      setSyncError(t('dhis2.syncNotSent'));
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = async (format: 'json' | 'csv') => {
    setExporting(true);
    setExportError('');
    try {
      const { generateDHIS2Export, exportToJSON, exportToCSV } = await import('@/lib/services/dhis2-export-service');
      const dataset = await generateDHIS2Export(period, buildExportScope());
      const content = format === 'json' ? exportToJSON(dataset) : exportToCSV(dataset);
      // No BOM: DHIS2 parses this, and a strict reader treats the mark as
      // part of the first column name.
      downloadFile(
        content,
        `dhis2-export-${safeFilenamePart(period)}.${format}`,
        format === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
      );
      setExportResult({ format: format.toUpperCase(), rows: dataset.dataValues?.length ?? 0, date: new Date().toLocaleString() });
    } catch (err) {
      console.error('Export failed', err);
      setExportError(t('dhis2.exportNotCreated'));
    } finally {
      setExporting(false);
    }
  };

  // Aggregate summary from real records. "OPD visits" was the patient count
  // again under another name, so it is not repeated here.
  const summaryData = [
    { label: t('dhis2.summaryTotalPatients'), value: patients.length, detail: t('dhis2.summaryTotalPatientsDetail') },
    { label: t('dhis2.summaryMalariaCases'), value: diseaseAlerts.filter(a => a.disease?.toLowerCase().includes('malaria')).length, detail: t('dhis2.summaryMalariaDetail') },
    { label: t('dhis2.summaryActiveSurveillanceAlerts'), value: diseaseAlerts.length, detail: t('dhis2.summaryAlertsDetail') },
    { label: t('dhis2.summaryAncVisits'), value: ancStats?.totalVisits || 0, detail: t('dhis2.summaryAncDetail') },
    { label: t('dhis2.summaryImmunizationsGiven'), value: immStats?.totalVaccinations || 0, detail: t('dhis2.summaryImmDetail') },
  ];

  const tabs = [
    { id: 'overview' as const, label: t('dhis2.tabDataElements'), icon: Database },
    { id: 'reports' as const, label: t('dhis2.tabHmisReports'), icon: FileText },
    { id: 'aggregate' as const, label: t('dhis2.tabAggregateData'), icon: BarChart3 },
    { id: 'export' as const, label: t('action.export'), icon: Download },
    { id: 'log' as const, label: t('dhis2.tabSyncLog'), icon: Clock },
  ];

  return (
    <>
      <main className="page-container page-enter">

        {/* What goes to DHIS2: the period and the level, then the one command
            that sends it. They used to sit on the Export tab only, though a
            sync reads the same two choices. */}
        <section className="dx-controls" aria-label={t('dhis2.controlsTitle')} data-tour="dhis2-export-config">
          <h2 className="dx-controls-title">{t('dhis2.controlsTitle')}</h2>
          <div className="dx-controls-row">
            <label className="dx-field">
              <span>{t('dhis2.reportingPeriod')}</span>
              <input type="month" value={period} onChange={e => setPeriod(e.target.value)} />
            </label>
            <label className="dx-field">
              <span>{t('dhis2.aggregationLevel')}</span>
              <Select value={exportLevel} onChange={e => setExportLevel(e.target.value as typeof exportLevel)}>
                <option value="facility" disabled={!currentUser?.hospitalId}>{t('dhis2.levelFacility')}{currentUser?.hospitalId ? '' : ` ${t('dhis2.noFacilityAssigned')}`}</option>
                <option value="payam" disabled={!u?.payam}>{t('dhis2.levelPayam')}{u?.payam ? '' : ` ${t('dhis2.noneSetOnUser')}`}</option>
                <option value="county" disabled={!u?.county}>{t('dhis2.levelCounty')}{u?.county ? '' : ` ${t('dhis2.noneSetOnUser')}`}</option>
                <option value="state" disabled={!u?.state}>{t('dhis2.levelState')}{u?.state ? '' : ` ${t('dhis2.noneSetOnUser')}`}</option>
                <option value="national" disabled={!nationalAllowed}>{t('dhis2.levelNational')}{nationalAllowed ? '' : ` ${t('dhis2.nationalRestricted')}`}</option>
              </Select>
            </label>
            <button type="button" onClick={handleSync} disabled={syncing} className="btn btn-primary dx-sync" data-action="dhis2-sync">
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? t('dhis2.syncing') : t('dhis2.syncNow')}
            </button>
          </div>
          <p className="dx-controls-help">{t('dhis2.tierHelp')}</p>
        </section>

        {syncError && <InlineBanner tone="danger" onDismiss={() => setSyncError('')}>{syncError}</InlineBanner>}

        {/* Status band: each tile says what it is made of and opens the tab
            that owns it. The sync log carries one entry per attempt, not a
            series, so there is no honest period comparison to trend. */}
        <div className="sadb-kpi-row dx-kpis" data-tour="dhis2-status-cards">
          <SadbKpiTile
            label={t('dhis2.statConnection')}
            value={dhis2Configured ? t('dhis2.statConnectionActive') : t('dhis2.statNotConfigured')}
            delta={dhis2Configured ? (dhis2Host || t('dhis2.statConnectionDetail')) : t('dhis2.statNotConfiguredDetail')}
            deltaTone={dhis2Configured ? undefined : 'warn'}
          />
          <SadbKpiTile
            label={t('dhis2.tabDataElements')}
            value={snapshotValues ? `${lastPushSucceeded ? elementCount : 0} / ${elementCount}` : '—'}
            delta={snapshotValues ? t('dhis2.statElementsDetail') : t('dhis2.statNoSync')}
            onClick={() => setActiveTab('overview')}
          />
          <SadbKpiTile
            label={t('dhis2.statReportsDue')}
            value={String(reportsSubmitted ? 0 : REPORT_TYPES.length)}
            delta={t('dhis2.statReportsDetail', { count: REPORT_TYPES.length, period })}
            deltaTone={reportsSubmitted ? undefined : 'warn'}
            onClick={() => setActiveTab('reports')}
          />
          <SadbKpiTile
            label={t('dhis2.statLastSync')}
            value={lastSyncedLabel ? lastSyncShort : t('dhis2.statNever')}
            delta={lastSyncedLabel || t('dhis2.statLastSyncNone')}
            onClick={() => setActiveTab('log')}
          />
        </div>

        {/* Tabs: underline strip, no fill */}
        <div role="tablist" data-tab-style="underline" className="dx-tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              data-tour={`dhis2-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className="dx-tab"
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── DATA ELEMENTS TAB ── */}
        {activeTab === 'overview' && (
          <div className="card-elevated overflow-hidden">
            {!snapshotValues ? (
              <div className="sadb-empty text-center py-12">
                <Database className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('dhis2.noSyncTitle')}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t('dhis2.noSyncHelp', { action: t('dhis2.syncNow') })}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th>{t('dhis2.colDataElement')}</th>
                      <th>{t('dhis2.colValue')}</th>
                      <th>{t('pharmacy.category')}</th>
                      <th>{t('lab.status')}</th>
                      <th>{t('dhis2.statLastSync')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {elementGroups.flatMap(group => group.elements.map(de => (
                      <tr key={`${group.label}-${de.dataElement}`}>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {de.dataElement.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())}
                        </td>
                        <td className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{de.value}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{group.label}</td>
                        <td>
                          <span className={`sadb-chip ${lastPushSucceeded ? 'sadb-chip--green' : 'sadb-chip--yellow'}`}>
                            {lastPushSucceeded ? t('sync.synced') : t('lab.filterPending')}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-secondary)' }}>{lastSyncedLabel || '—'}</td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── HMIS REPORTS TAB ── */}
        {activeTab === 'reports' && (
          <div className="card-elevated overflow-hidden" data-tour="dhis2-reports-list">
            {/* Every HMIS report here is fed by the same aggregate dataset push,
                so status and completeness come from the real last sync for the
                selected period, not from per-report figures. */}
            <div className="overflow-x-auto">
              <table className="w-full" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th>{t('dhis2.colReport')}</th>
                    <th>{t('dhis2.colPeriod')}</th>
                    <th>{t('dhis2.colCompleteness')}</th>
                    <th>{t('lab.status')}</th>
                    <th>{t('dhis2.colNextStep')}</th>
                  </tr>
                </thead>
                <tbody>
                  {REPORT_TYPES.map(report => (
                    <tr key={report.name}>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{report.name}</td>
                      <td className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{period}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="h-2 rounded-full overflow-hidden flex-shrink-0" style={{ width: 90, background: 'var(--overlay-medium)' }}>
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${reportCompleteness}%`,
                                background: reportCompleteness === 100 ? 'var(--color-success)' : reportCompleteness > 50 ? 'var(--accent-primary)' : 'var(--color-warning)',
                              }}
                            />
                          </div>
                          <span className="tabular-nums" style={{ fontWeight: 600 }}>{reportCompleteness}%</span>
                        </div>
                      </td>
                      <td>
                        <span className={`sadb-chip ${reportsSubmitted ? 'sadb-chip--green' : 'sadb-chip--yellow'}`}>
                          {reportsSubmitted ? t('dhis2.statusSubmitted') : t('lab.filterPending')}
                        </span>
                      </td>
                      <td>
                        {reportsSubmitted ? (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        ) : (
                          <span className="flex items-center gap-4">
                            <button type="button" className="dx-opener" onClick={() => setActiveTab('aggregate')}>{t('dhis2.reviewData')}</button>
                            <button type="button" className="dx-opener" onClick={handleSync} disabled={syncing}>
                              {syncing ? t('dhis2.submitting') : t('action.submit')}
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── AGGREGATE DATA TAB ── */}
        {activeTab === 'aggregate' && (
          <div>
            {/* Running totals of what is on record, not one month: the export
                is what uses the selected period. */}
            <h2 className="dx-section-title">{t('dhis2.autoAggregated')}</h2>
            <p className="dx-section-sub">{t('dhis2.totalsToDate')}{hospitalName ? ` · ${hospitalName}` : ''}</p>
            <div className="sadb-kpi-row dx-kpis">
              {summaryData.map(item => (
                <SadbKpiTile key={item.label} label={item.label} value={item.value.toLocaleString()} delta={item.detail} />
              ))}
            </div>
          </div>
        )}

        {/* ── EXPORT TAB ── */}
        {activeTab === 'export' && (
          <div className="dx-export-grid">
            <div className="card-elevated dx-card">
              <h2 className="dx-card-title">{t('dhis2.dataElementsIncluded')}</h2>
              <ul className="dx-include">
                {[
                  t('dhis2.includePopulationHealth'),
                  t('dhis2.includeCrvs'),
                  t('dhis2.includeMortality'),
                  t('dhis2.includeSurveillance'),
                  t('dhis2.includeDataQuality'),
                  t('dhis2.includePerFacility'),
                ].map(item => (
                  <li key={item}>
                    <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card-elevated dx-card">
              <h2 className="dx-card-title">{t('dhis2.exportFormat')}</h2>
              <div className="dx-formats">
                <button type="button" onClick={() => handleExport('json')} disabled={exporting} className="dx-format">
                  <span className="dx-format-head"><FileJson className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />JSON</span>
                  <span className="dx-format-desc">{t('dhis2.jsonDesc')}</span>
                  <span className="dx-opener-text">
                    {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    {t('dhis2.downloadJson')}
                  </span>
                </button>
                <button type="button" onClick={() => handleExport('csv')} disabled={exporting} className="dx-format">
                  <span className="dx-format-head"><FileSpreadsheet className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />CSV</span>
                  <span className="dx-format-desc">{t('dhis2.csvDesc')}</span>
                  <span className="dx-opener-text">
                    {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    {t('dhis2.downloadCsv')}
                  </span>
                </button>
              </div>
              {exportError && <InlineBanner tone="danger" onDismiss={() => setExportError('')}>{exportError}</InlineBanner>}
              {exportResult && (
                <InlineBanner tone="success" title={t('dhis2.exportSuccessful')}>
                  {t('dhis2.exportSummary', { rows: exportResult.rows, format: exportResult.format, period, date: exportResult.date })}
                </InlineBanner>
              )}
            </div>
          </div>
        )}

        {/* ── SYNC LOG TAB ── */}
        {activeTab === 'log' && (
          <div className="card-elevated overflow-hidden" data-tour="dhis2-sync-log">
            {(log?.entries ?? []).length > 0 && (
              <table className="w-full">
                <thead>
                  <tr>
                    <th>{t('dhis2.colTime')}</th>
                    <th>{t('lab.status')}</th>
                    <th>{t('dhis2.colMessage')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(log?.entries ?? []).map((entry, i) => (
                    <tr key={`${entry.time}-${i}`}>
                      <td className="tabular-nums" style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{new Date(entry.time).toLocaleString()}</td>
                      <td>
                        <span className={`sadb-chip ${entry.status === 'success' ? 'sadb-chip--green' : entry.status === 'error' ? 'sadb-chip--red' : 'sadb-chip--blue'}`}>
                          {entry.status === 'success' ? t('dhis2.logSuccess') : entry.status === 'error' ? t('dhis2.logError') : t('dhis2.logInfo')}
                        </span>
                      </td>
                      <td style={{ color: entry.status === 'error' ? 'var(--color-danger-text)' : 'var(--text-primary)' }}>{entry.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(log?.entries ?? []).length === 0 && (
              <div className="sadb-empty text-center py-12">
                <Clock className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('dhis2.noSyncActivity')}</p>
              </div>
            )}
          </div>
        )}

      </main>
    </>
  );
}
