'use client';

import EhrPageGreeting from '@/components/ehr/EhrPageGreeting';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useVitalStatistics } from '@/lib/hooks/useVitalStatistics';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useDataQuality } from '@/lib/hooks/useDataQuality';
import { useFacilityAssessments } from '@/lib/hooks/useFacilityAssessments';
import { useFacilityCensus } from '@/lib/hooks/useFacilityCensus';
import { Baby, Skull, Activity, Heart, Shield, Building2, Users, BedDouble, Stethoscope, Wifi } from '@/components/icons/lucide';

type SectionId = 'overview' | 'births' | 'mortality' | 'readiness' | 'quality';

export default function PublicStatsPage() {
  const { t } = useTranslation();
  const { data: vitalData, loading: vLoading } = useVitalStatistics();
  const { hospitals } = useHospitals();
  const { data: dqData, loading: dqLoading } = useDataQuality();
  const { summary: assessmentSummary } = useFacilityAssessments();
  const { census } = useFacilityCensus();
  const [section, setSection] = useState<SectionId>('overview');

  const loading = vLoading || dqLoading;

  if (loading || !vitalData) return <><main className="page-container flex items-center justify-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('publicStats.loading')}</p></main></>;

  const { birthStats, deathStats } = vitalData;
  // Summed from real patient records — HospitalDoc.patientCount is a
  // write-once-zero registry field, which published "0 patients" as the
  // national figure on this PUBLIC page for every real deployment.
  const totalPop = census
    ? Array.from(census.values()).reduce((s, c) => s + c.patients, 0)
    : 0;
  const totalBeds = hospitals.reduce((s, h) => s + h.totalBeds, 0);
  const totalStaff = hospitals.reduce((s, h) => s + h.doctors + h.nurses + h.clinicalOfficers, 0);

  const scoreColor = (score: number) => score >= 70 ? 'var(--accent-primary)' : score >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';

  const sections: { id: SectionId; label: string; icon: typeof Shield; count?: number | string }[] = [
    { id: 'overview', label: t('publicStats.nationalOverview'), icon: Shield, count: hospitals.length },
    { id: 'births', label: t('publicStats.birthRegistration'), icon: Baby, count: birthStats.total },
    { id: 'mortality', label: t('publicStats.mortalityStatistics'), icon: Skull, count: deathStats.total },
    ...(assessmentSummary ? [{ id: 'readiness' as SectionId, label: t('publicStats.healthSystemReadiness'), icon: Activity, count: assessmentSummary.facilitiesAssessed }] : []),
    ...(dqData ? [{ id: 'quality' as SectionId, label: t('publicStats.dataQualityIndicators'), icon: Heart }] : []),
  ];

  return (
    <>
      <main className="page-container page-enter">
        <div className="dash-card mb-4" style={{ padding: '16px 20px' }}>
          <EhrPageGreeting module={t('hospitalManager.publicStatistics')} />
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <aside style={{ width: 224, flexShrink: 0 }}>
            <nav className="ehr-set-nav" aria-label="Public statistics sections">
              {sections.map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={section === item.id ? 'active' : undefined}
                    onClick={() => setSection(item.id)}
                  >
                    <Icon />
                    <em>{item.label}</em>
                    {item.count !== undefined && <b>{item.count}</b>}
                  </button>
                );
              })}
            </nav>
          </aside>

          <section style={{ flex: 1, minWidth: 0 }}>
            {/* National Overview */}
            {section === 'overview' && (
              <div data-tour="public-stats-overview" className="card-elevated p-5 mb-6" style={{ background: 'rgba(33, 145, 208,0.04)' }}>
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
                  <h2 className="font-semibold text-sm">{t('publicStats.nationalOverview')}</h2>
                </div>
                <div className="kpi-grid">
                  {[
                    { label: t('publicStats.healthFacilities'), value: hospitals.length, icon: Building2, color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.12)' },
                    { label: t('patients.kpiTotalPatients'), value: totalPop.toLocaleString(), icon: Users, color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.12)' },
                    { label: t('publicStats.hospitalBeds'), value: totalBeds.toLocaleString(), icon: BedDouble, color: 'var(--color-warning-text)', bg: 'rgba(253, 217, 95,0.12)' },
                    { label: t('publicStats.healthWorkers'), value: totalStaff.toLocaleString(), icon: Stethoscope, color: 'var(--accent-primary)', bg: 'rgba(124, 199, 255,0.12)' },
                    { label: t('publicStats.dhis2Coverage'), value: `${dqData?.dhis2Adoption ?? 0}%`, icon: Wifi, color: scoreColor(dqData?.dhis2Adoption ?? 0), bg: 'rgba(33, 145, 208, 0.12)' },
                  ].map(stat => (
                    <div key={stat.label} className="kpi">
                      <div className="kpi__icon">
                        <stat.icon style={{ color: stat.color }} />
                      </div>
                      <div className="kpi__body">
                        <div className="kpi__value">{stat.value}</div>
                        <div className="kpi__label">{stat.label}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Birth Registration */}
            {section === 'births' && (
              <div className="card-elevated p-5 mb-6">
                <div className="flex items-center gap-2 mb-4">
                  <Baby className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
                  <h2 className="font-semibold text-sm">{t('publicStats.birthRegistration')}</h2>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="p-3 rounded-lg" style={{ background: 'var(--accent-light)' }}>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('publicStats.totalBirthsRegistered')}</p>
                    <p className="text-xl font-bold" style={{ color: 'var(--accent-primary)' }}>{birthStats.total}</p>
                  </div>
                  <div className="p-3 rounded-lg" style={{ background: 'var(--accent-light)' }}>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('births.statThisMonth')}</p>
                    <p className="text-xl font-bold" style={{ color: 'var(--accent-primary)' }}>{birthStats.thisMonth}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-secondary)' }}>{t('publicStats.maleBirths')}</span>
                    <span className="font-bold" style={{ color: 'var(--accent-primary)' }}>{birthStats.byGender.male}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-secondary)' }}>{t('publicStats.femaleBirths')}</span>
                    <span className="font-bold" style={{ color: 'var(--color-danger-text)' }}>{birthStats.byGender.female}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-secondary)' }}>{t('publicStats.caesareanRate')}</span>
                    <span className="font-bold">{birthStats.total ? Math.round(birthStats.byDeliveryType.caesarean / birthStats.total * 100) : 0}%</span>
                  </div>
                </div>
                {Object.keys(birthStats.byState).length > 0 && (
                  <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border-light)' }}>
                    <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>{t('publicStats.birthsByState')}</p>
                    <div className="space-y-1.5">
                      {Object.entries(birthStats.byState).sort(([, a], [, b]) => b - a).map(([state, count]) => (
                        <div key={state} className="flex items-center gap-2">
                          <span className="text-[10px] w-36 truncate" style={{ color: 'var(--text-muted)' }}>{state}</span>
                          <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--overlay-light)' }}>
                            <div className="h-full rounded-full" style={{ width: `${birthStats.total ? (count / birthStats.total) * 100 : 0}%`, background: 'var(--accent-primary)' }} />
                          </div>
                          <span className="text-[10px] font-bold w-6 text-end">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Mortality Statistics */}
            {section === 'mortality' && (
              <div className="card-elevated p-5 mb-6">
                <div className="flex items-center gap-2 mb-4">
                  <Skull className="w-5 h-5" style={{ color: 'var(--color-danger)' }} />
                  <h2 className="font-semibold text-sm">{t('publicStats.mortalityStatistics')}</h2>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="p-3 rounded-lg" style={{ background: 'rgba(224, 49, 39,0.08)' }}>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('publicStats.totalDeaths')}</p>
                    <p className="text-xl font-bold" style={{ color: 'var(--color-danger-text)' }}>{deathStats.total}</p>
                  </div>
                  <div className="p-3 rounded-lg" style={{ background: 'var(--accent-light)' }}>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('publicStats.icd11Coded')}</p>
                    <p className="text-xl font-bold" style={{ color: 'var(--accent-primary)' }}>{deathStats.total ? Math.round(deathStats.withICD11Code / deathStats.total * 100) : 0}%</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-secondary)' }}>{t('publicStats.maternalDeaths')}</span>
                    <span className="font-bold" style={{ color: 'var(--color-danger-text)' }}>{deathStats.maternalDeaths}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-secondary)' }}>{t('publicStats.under5Deaths')}</span>
                    <span className="font-bold" style={{ color: 'var(--color-warning-text)' }}>{deathStats.under5Deaths}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-secondary)' }}>{t('publicStats.neonatalDeaths')}</span>
                    <span className="font-bold" style={{ color: 'var(--color-warning-text)' }}>{deathStats.neonatalDeaths}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-secondary)' }}>{t('publicStats.deathNotificationRate')}</span>
                    <span className="font-bold" style={{ color: scoreColor(deathStats.total ? Math.round(deathStats.notified / deathStats.total * 100) : 0) }}>
                      {deathStats.total ? Math.round(deathStats.notified / deathStats.total * 100) : 0}%
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-secondary)' }}>{t('publicStats.deathRegistrationRate')}</span>
                    <span className="font-bold" style={{ color: scoreColor(deathStats.total ? Math.round(deathStats.registered / deathStats.total * 100) : 0) }}>
                      {deathStats.total ? Math.round(deathStats.registered / deathStats.total * 100) : 0}%
                    </span>
                  </div>
                </div>
                {deathStats.topCauses.length > 0 && (
                  <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border-light)' }}>
                    <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>{t('publicStats.topCausesOfDeath')}</p>
                    <div className="space-y-1.5">
                      {deathStats.topCauses.slice(0, 5).map((c, i) => (
                        <div key={c.code} className="flex items-center gap-2">
                          <span className="text-[10px] font-bold w-4" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
                          <span className="font-mono text-[10px] px-1 py-0.5 rounded" style={{ background: 'rgba(224, 49, 39,0.12)', color: 'var(--color-danger-text)' }}>{c.code}</span>
                          <span className="text-[10px] flex-1 truncate">{c.cause}</span>
                          <span className="text-xs font-bold">{c.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Health System Readiness */}
            {section === 'readiness' && assessmentSummary && (
              <div className="card-elevated p-5 mb-6">
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
                  <h2 className="font-semibold text-sm">{t('publicStats.healthSystemReadiness')}</h2>
                  <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)' }}>{t('publicStats.facilitiesAssessed', { count: assessmentSummary.facilitiesAssessed })}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  <div className="space-y-3">
                    {[
                      { label: t('publicStats.generalEquipment'), score: assessmentSummary.avgEquipmentScore },
                      { label: t('publicStats.diagnosticCapacity'), score: assessmentSummary.avgDiagnosticScore },
                    ].map(item => (
                      <div key={item.label}>
                        <div className="flex justify-between text-xs mb-1">
                          <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                          <span className="font-bold" style={{ color: scoreColor(item.score) }}>{item.score}%</span>
                        </div>
                        <div className="w-full h-2 rounded-full" style={{ background: 'var(--overlay-light)' }}>
                          <div className="h-full rounded-full" style={{ width: `${item.score}%`, background: scoreColor(item.score) }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-3">
                    {[
                      { label: t('publicStats.essentialMedicines'), score: assessmentSummary.avgMedicinesScore },
                      { label: t('publicStats.staffingAdequacy'), score: assessmentSummary.avgStaffingScore },
                    ].map(item => (
                      <div key={item.label}>
                        <div className="flex justify-between text-xs mb-1">
                          <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                          <span className="font-bold" style={{ color: scoreColor(item.score) }}>{item.score}%</span>
                        </div>
                        <div className="w-full h-2 rounded-full" style={{ background: 'var(--overlay-light)' }}>
                          <div className="h-full rounded-full" style={{ width: `${item.score}%`, background: scoreColor(item.score) }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-3">
                    {[
                      { label: t('breadcrumb.dataQuality'), score: assessmentSummary.avgDataQuality },
                      { label: t('publicStats.reportingCompleteness'), score: assessmentSummary.avgReportingCompleteness },
                    ].map(item => (
                      <div key={item.label}>
                        <div className="flex justify-between text-xs mb-1">
                          <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                          <span className="font-bold" style={{ color: scoreColor(item.score) }}>{item.score}%</span>
                        </div>
                        <div className="w-full h-2 rounded-full" style={{ background: 'var(--overlay-light)' }}>
                          <div className="h-full rounded-full" style={{ width: `${item.score}%`, background: scoreColor(item.score) }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Data Quality Summary */}
            {section === 'quality' && dqData && (
              <div className="card-elevated p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Heart className="w-5 h-5" style={{ color: 'var(--color-danger)' }} />
                  <h2 className="font-semibold text-sm">{t('publicStats.dataQualityIndicators')}</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-3 rounded-lg text-center" style={{ background: 'var(--overlay-subtle)' }}>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('publicStats.completeness')}</p>
                    <p className="text-xl font-bold" style={{ color: scoreColor(dqData.avgCompleteness) }}>{dqData.avgCompleteness}%</p>
                  </div>
                  <div className="p-3 rounded-lg text-center" style={{ background: 'var(--overlay-subtle)' }}>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('publicStats.timeliness')}</p>
                    <p className="text-xl font-bold" style={{ color: scoreColor(dqData.avgTimeliness) }}>{dqData.avgTimeliness}%</p>
                  </div>
                  <div className="p-3 rounded-lg text-center" style={{ background: 'var(--overlay-subtle)' }}>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('publicStats.accuracy')}</p>
                    <p className="text-xl font-bold" style={{ color: scoreColor(dqData.avgQuality) }}>{dqData.avgQuality}%</p>
                  </div>
                  <div className="p-3 rounded-lg text-center" style={{ background: 'var(--overlay-subtle)' }}>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('publicStats.hisWorkforce')}</p>
                    <p className="text-xl font-bold" style={{ color: 'var(--accent-primary)' }}>{dqData.totalHISStaff}</p>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
