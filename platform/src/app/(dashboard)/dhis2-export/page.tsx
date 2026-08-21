'use client';

import { useState, useEffect, useMemo } from 'react';
import EhrListHeader from '@/components/ehr/EhrListHeader';
import {
  RefreshCw, CheckCircle, Clock, AlertTriangle,
  Download, FileJson, FileSpreadsheet, Upload, Loader2,
  Wifi, Database, FileText, BarChart3,
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
  const [activeTab, setActiveTab] = useState<'overview' | 'reports' | 'aggregate' | 'export' | 'log'>('overview');
  const [syncing, setSyncing] = useState(false);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [exportLevel, setExportLevel] = useState<'facility' | 'payam' | 'county' | 'state' | 'national'>('facility');
  const [exporting, setExporting] = useState(false);
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
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = async (format: 'json' | 'csv') => {
    setExporting(true);
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
    } finally {
      setExporting(false);
    }
  };

  // Aggregate summary from real patient data
  const summaryData = [
    { label: t('dhis2.summaryOpdVisits'), value: patients.length, icon: BarChart3, color: 'var(--accent-primary)' },
    { label: t('dhis2.summaryMalariaCases'), value: diseaseAlerts.filter(a => a.disease?.toLowerCase().includes('malaria')).length, icon: AlertTriangle, color: 'var(--color-danger)' },
    { label: t('dhis2.summaryActiveSurveillanceAlerts'), value: diseaseAlerts.length, icon: AlertTriangle, color: 'var(--color-warning)' },
    { label: t('dhis2.summaryAncVisits'), value: ancStats?.totalVisits || 0, icon: FileText, color: 'var(--chart-2)' },
    { label: t('dhis2.summaryImmunizationsGiven'), value: immStats?.totalVaccinations || 0, icon: CheckCircle, color: 'var(--color-success-text)' },
    { label: t('dhis2.summaryTotalPatients'), value: patients.length, icon: Database, color: 'var(--chart-3)' },
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

        <div className="dash-card mb-4">
          <EhrListHeader
            title={t('dhis2.pageTitle')}
            actions={
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                style={{
                  background: syncing ? 'var(--overlay-medium)' : 'linear-gradient(135deg, #2191D0, #015697)',
                  color: syncing ? 'var(--text-muted)' : '#fff',
                  boxShadow: syncing ? 'none' : '0 4px 12px rgba(33, 145, 208, 0.3)',
                }}
              >
                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? t('dhis2.syncing') : t('dhis2.syncNow')}
              </button>
            }
          />
        </div>

        {/* Status Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6" data-tour="dhis2-status-cards">
          {[
            dhis2Configured
              ? { label: t('dhis2.statConnection'), value: t('dhis2.statConnectionActive'), icon: Wifi, color: 'var(--color-success-text)', sub: dhis2Host || '' }
              : { label: t('dhis2.statConnection'), value: 'Not configured', icon: Wifi, color: 'var(--color-warning-text)', sub: 'Set NEXT_PUBLIC_DHIS2_BASE_URL' },
            { label: t('dhis2.tabDataElements'), value: snapshotValues ? `${lastPushSucceeded ? elementCount : 0}/${elementCount}` : '—', icon: Database, color: 'var(--accent-primary)', sub: snapshotValues ? t('sync.synced') : 'No sync run yet' },
            { label: t('dhis2.statReportsDue'), value: String(reportsSubmitted ? 0 : REPORT_TYPES.length), icon: FileText, color: 'var(--color-warning-text)', sub: t('dhis2.statPendingCompletion') },
            { label: t('dhis2.statLastSync'), value: lastSyncedLabel ? lastSyncShort : 'Never', icon: Clock, color: 'var(--accent-hover)', sub: lastSyncedLabel || 'Run a sync to push data' },
          ].map((stat) => (
            <div key={stat.label} className="card-elevated p-4">
              <div className="flex items-center gap-2 mb-2">
                <stat.icon className="w-4 h-4" style={{ color: stat.color }} />
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{stat.label}</span>
              </div>
              <p className="text-xl font-bold" style={{ color: stat.color }}>{stat.value}</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{stat.sub}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b mb-5 overflow-x-auto" style={{ borderColor: 'var(--border-light)' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              data-tour={`dhis2-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap transition-colors"
              style={{
                color: activeTab === tab.id ? 'var(--accent-primary)' : 'var(--text-muted)',
                borderBottom: activeTab === tab.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
              }}
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
              <div className="text-center py-12">
                <Database className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>No sync has run yet</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  Press “{t('dhis2.syncNow')}” to generate the current dataset and push it to DHIS2 — the real data elements will appear here.
                </p>
              </div>
            ) : (
              <>
                <div className="hidden sm:grid" style={{
                  gridTemplateColumns: '2fr 1fr 1.2fr 0.8fr 1.2fr',
                  padding: '10px 20px',
                  borderBottom: '1px solid var(--border-light)',
                }}>
                  {[t('dhis2.colDataElement'), 'Value', t('pharmacy.category'), t('lab.status'), t('dhis2.statLastSync')].map(h => (
                    <span key={h} className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{h}</span>
                  ))}
                </div>
                {elementGroups.flatMap(group => group.elements.map(de => (
                  <div
                    key={`${group.label}-${de.dataElement}`}
                    className="sm:grid items-center transition-colors"
                    style={{
                      gridTemplateColumns: '2fr 1fr 1.2fr 0.8fr 1.2fr',
                      padding: '12px 20px',
                      borderBottom: '1px solid var(--border-light)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1 sm:mb-0">
                      <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                        {de.dataElement.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                      </span>
                    </div>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{de.value}</span>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{group.label}</span>
                    <div>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                        lastPushSucceeded ? 'badge-normal' : 'badge-warning'
                      }`}>
                        {lastPushSucceeded ? t('sync.synced') : t('lab.filterPending')}
                      </span>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{lastSyncedLabel || '—'}</span>
                  </div>
                )))}
              </>
            )}
          </div>
        )}

        {/* ── HMIS REPORTS TAB ── */}
        {activeTab === 'reports' && (
          <div className="space-y-3" data-tour="dhis2-reports-list">
            {/* Every HMIS report here is fed by the same aggregate dataset push,
                so status/completeness derive from the REAL last sync for the
                selected period — not per-report fabrications. */}
            {REPORT_TYPES.map((report) => (
              <div key={report.name} className="card-elevated p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{report.name}</h3>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{period}{lastSyncedLabel ? ` · ${t('dhis2.statLastSync')}: ${lastSyncedLabel}` : ''}</p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-md ${
                    reportsSubmitted ? 'badge-normal' : 'badge-muted'
                  }`} style={reportsSubmitted ? {} : { background: 'var(--overlay-subtle)', color: 'var(--text-muted)' }}>
                    {reportsSubmitted ? 'submitted' : 'pending'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--overlay-medium)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${reportCompleteness}%`,
                        background: reportCompleteness === 100 ? 'var(--color-success)' : reportCompleteness > 50 ? 'var(--accent-primary)' : 'var(--color-warning)',
                      }}
                    />
                  </div>
                  <span className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)', minWidth: '36px' }}>
                    {reportCompleteness}%
                  </span>
                </div>
                {!reportsSubmitted && (
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => setActiveTab('aggregate')}
                      className="text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors"
                      style={{
                        background: 'var(--accent-light)',
                        color: 'var(--accent-primary)',
                        border: '1px solid var(--accent-border)',
                      }}
                    >
                      <FileText className="w-3 h-3" /> {t('dhis2.reviewData')}
                    </button>
                    <button
                      onClick={handleSync}
                      disabled={syncing}
                      className="text-xs font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      style={{
                        background: 'rgba(79, 199, 155,0.08)',
                        color: 'var(--color-success-text)',
                        border: '1px solid rgba(79, 199, 155,0.15)',
                        cursor: syncing ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <Upload className="w-3 h-3" /> {syncing ? t('dhis2.submitting') : t('action.submit')}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── AGGREGATE DATA TAB ── */}
        {activeTab === 'aggregate' && (
          <div>
            <div className="card-elevated p-5 mb-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{t('dhis2.autoAggregated')}</h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>February 2026 · {hospitalName}</p>
                </div>
                <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-md" style={{
                  background: 'var(--accent-light)',
                  color: 'var(--accent-primary)',
                }}>{t('dhis2.liveData')}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {summaryData.map((item) => (
                  <div key={item.label} className="p-4 rounded-xl" style={{
                    background: 'var(--overlay-subtle)',
                    border: '1px solid var(--border-light)',
                  }}>
                    <div className="flex items-center gap-2 mb-2">
                      <item.icon className="w-4 h-4" style={{ color: item.color }} />
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.label}</span>
                    </div>
                    <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{item.value}</p>
                    <p className="text-[10px] font-bold mt-1" style={{ color: item.color }}>{t('dhis2.mapsToDhis2')}</p>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white transition-all"
              style={{
                background: 'linear-gradient(135deg, #2191D0, #015697)',
                boxShadow: '0 4px 12px rgba(33, 145, 208, 0.3)',
              }}
            >
              <Upload className="w-4 h-4" />
              {t('dhis2.pushAggregateData')}
            </button>
          </div>
        )}

        {/* ── EXPORT TAB ── */}
        {activeTab === 'export' && (
          <div className="max-w-2xl">
            <div className="card-elevated p-6 mb-5" data-tour="dhis2-export-config">
              <h3 className="font-semibold text-sm mb-4">{t('dhis2.exportConfiguration')}</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('dhis2.reportingPeriod')}</label>
                  <input
                    type="month"
                    value={period}
                    onChange={e => setPeriod(e.target.value)}
                    className="w-full p-2.5 rounded-xl text-sm outline-none"
                    style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('dhis2.aggregationLevel')}</label>
                  <Select
                    value={exportLevel}
                    onChange={e => setExportLevel(e.target.value as typeof exportLevel)}
                    className="w-full p-2.5 rounded-xl text-sm outline-none"
                    style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}
                  >
                    <option value="facility" disabled={!currentUser?.hospitalId}>{t('dhis2.levelFacility')}{currentUser?.hospitalId ? '' : ` ${t('dhis2.noFacilityAssigned')}`}</option>
                    <option value="payam" disabled={!u?.payam}>{t('dhis2.levelPayam')}{u?.payam ? '' : ` ${t('dhis2.noneSetOnUser')}`}</option>
                    <option value="county" disabled={!u?.county}>{t('dhis2.levelCounty')}{u?.county ? '' : ` ${t('dhis2.noneSetOnUser')}`}</option>
                    <option value="state" disabled={!u?.state}>{t('dhis2.levelState')}{u?.state ? '' : ` ${t('dhis2.noneSetOnUser')}`}</option>
                    <option value="national" disabled={!nationalAllowed}>{t('dhis2.levelNational')}{nationalAllowed ? '' : ` ${t('dhis2.nationalRestricted')}`}</option>
                  </Select>
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>{t('dhis2.tierHelp')}</p>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider mb-2 block" style={{ color: 'var(--text-muted)' }}>{t('dhis2.dataElementsIncluded')}</label>
                  <div className="space-y-1.5">
                    {[
                      t('dhis2.includePopulationHealth'),
                      t('dhis2.includeCrvs'),
                      t('dhis2.includeMortality'),
                      t('dhis2.includeSurveillance'),
                      t('dhis2.includeDataQuality'),
                      t('dhis2.includePerFacility'),
                    ].map(item => (
                      <div key={item} className="flex items-center gap-2">
                        <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="card-elevated p-6 mb-5">
              <h3 className="font-semibold text-sm mb-4">{t('dhis2.exportFormat')}</h3>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => handleExport('json')}
                  disabled={exporting}
                  className="p-4 rounded-xl border text-start transition-all hover:shadow-md"
                  style={{ borderColor: 'var(--border-light)', background: 'var(--overlay-subtle)' }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <FileJson className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
                    <span className="font-semibold text-sm">JSON</span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('dhis2.jsonDesc')}</p>
                  <div className="mt-3 flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--accent-primary)' }}>
                    {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    {t('dhis2.downloadJson')}
                  </div>
                </button>
                <button
                  onClick={() => handleExport('csv')}
                  disabled={exporting}
                  className="p-4 rounded-xl border text-start transition-all hover:shadow-md"
                  style={{ borderColor: 'var(--border-light)', background: 'var(--overlay-subtle)' }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <FileSpreadsheet className="w-5 h-5" style={{ color: 'var(--color-success-text)' }} />
                    <span className="font-semibold text-sm">CSV</span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('dhis2.csvDesc')}</p>
                  <div className="mt-3 flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--color-success-text)' }}>
                    {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    {t('dhis2.downloadCsv')}
                  </div>
                </button>
              </div>
            </div>

            {exportResult && (
              <div className="card-elevated p-4" style={{ background: 'rgba(33, 145, 208, 0.06)', border: '1px solid var(--accent-border)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                  <span className="font-semibold text-sm" style={{ color: 'var(--accent-primary)' }}>{t('dhis2.exportSuccessful')}</span>
                </div>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {t('dhis2.exportSummary', { rows: exportResult.rows, format: exportResult.format, period, date: exportResult.date })}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── SYNC LOG TAB ── */}
        {activeTab === 'log' && (
          <div className="card-elevated overflow-hidden" data-tour="dhis2-sync-log">
            {(log?.entries ?? []).map((entry, i) => (
              <div
                key={`${entry.time}-${i}`}
                className="flex items-center gap-3 px-5 py-3 transition-colors"
                style={{
                  borderBottom: '1px solid var(--border-light)',
                  animation: i === 0 ? 'slideIn 0.3s ease' : undefined,
                }}
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{
                  background: entry.status === 'success' ? 'var(--color-success)' : entry.status === 'error' ? 'var(--color-danger)' : 'var(--accent-primary)',
                }} />
                <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--text-muted)', minWidth: '150px' }}>{new Date(entry.time).toLocaleString()}</span>
                <span className="text-sm" style={{
                  color: entry.status === 'error' ? 'var(--color-danger-text)' : 'var(--text-secondary)',
                }}>{entry.message}</span>
              </div>
            ))}
            {(log?.entries ?? []).length === 0 && (
              <div className="text-center py-12">
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
