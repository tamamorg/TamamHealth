'use client';

import EhrPageTitle from '@/components/ehr/EhrPageTitle';

import { useState } from 'react';
import { useVitalStatistics } from '@/lib/hooks/useVitalStatistics';
import { Baby, Skull, AlertTriangle, Activity } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

type SectionId = 'births' | 'mortality' | 'crvs';

export default function VitalStatisticsPage() {
  const { t } = useTranslation();
  const { data, loading } = useVitalStatistics();
  const [section, setSection] = useState<SectionId>('births');

  if (loading || !data) return <><main className="page-container flex items-center justify-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('vitalStats.loading')}</p></main></>;

  const { birthStats, deathStats } = data;

  const sections: { id: SectionId; label: string; icon: typeof Baby; count?: number }[] = [
    { id: 'births', label: t('vitalStats.birthStatistics'), icon: Baby, count: birthStats.total },
    { id: 'mortality', label: t('vitalStats.mortalityStatistics'), icon: Skull, count: deathStats.total },
    { id: 'crvs', label: t('vitalStats.crvsRegistrationGaps'), icon: AlertTriangle },
  ];

  return (
    <>
      <main className="page-container page-enter">
        <div className="dash-card mb-4" style={{ padding: '16px 20px' }}>
          <EhrPageTitle>{t('vitalStats.topBarTitle')}</EhrPageTitle>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <aside style={{ width: 224, flexShrink: 0 }}>
            <nav className="ehr-set-nav" aria-label="Vital statistics sections" data-tour="vs-section-nav">
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
            {/* Birth Statistics */}
            {section === 'births' && (
              <>
                <h2 className="font-semibold text-sm flex items-center gap-2 mb-3"><Baby className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} /> {t('vitalStats.birthStatistics')}</h2>
                <div className="kpi-grid mb-6">
                  {[
                    { label: t('vitalStats.totalBirths'), value: birthStats.total, icon: Baby, color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.12)' },
                    { label: t('births.statThisMonth'), value: birthStats.thisMonth, icon: Activity, color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.12)' },
                    { label: t('vitalStats.maleBirths'), value: birthStats.byGender.male, icon: Baby, color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.12)' },
                    { label: t('vitalStats.femaleBirths'), value: birthStats.byGender.female, icon: Baby, color: 'var(--color-danger-text)', bg: 'rgba(224, 49, 39,0.12)' },
                    { label: t('births.statCaesareanRate'), value: `${birthStats.total ? Math.round(birthStats.byDeliveryType.caesarean / birthStats.total * 100) : 0}%`, icon: Activity, color: 'var(--color-warning-text)', bg: 'rgba(253, 217, 95,0.12)' },
                  ].map(stat => (
                    <div key={stat.label} className="kpi">
                      <div className="icon-box-sm">
                        <stat.icon style={{ color: stat.color }} />
                      </div>
                      <div className="kpi__body">
                        <div className="kpi__value">{stat.value}</div>
                        <div className="kpi__label">{stat.label}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Births by State */}
                {Object.keys(birthStats.byState).length > 0 && (
                  <div className="card-elevated p-4 mb-6">
                    <h3 className="font-semibold text-sm mb-3">{t('vitalStats.birthsByState')}</h3>
                    <hr className="section-divider" />
                    <div className="space-y-2 data-row-divider-sm">
                      {Object.entries(birthStats.byState).sort(([, a], [, b]) => b - a).map(([state, count]) => (
                        <div key={state} className="flex items-center gap-3">
                          <span className="text-xs w-48 truncate" style={{ color: 'var(--text-secondary)' }}>{state}</span>
                          <div className="flex-1 h-2 rounded-full" style={{ background: 'var(--overlay-light)' }}>
                            <div className="h-full rounded-full" style={{ width: `${birthStats.total > 0 ? (count / birthStats.total) * 100 : 0}%`, background: 'var(--accent-primary)' }} />
                          </div>
                          <span className="text-sm font-bold w-8 text-end">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Death Statistics */}
            {section === 'mortality' && (
              <>
                <h2 className="font-semibold text-sm flex items-center gap-2 mb-3"><Skull className="w-4 h-4" style={{ color: 'var(--color-danger)' }} /> {t('vitalStats.mortalityStatistics')}</h2>
                <div className="kpi-grid mb-6">
                  {[
                    { label: t('deaths.statTotalDeaths'), value: deathStats.total, icon: Skull, color: 'var(--color-danger-text)', bg: 'rgba(224, 49, 39,0.12)' },
                    { label: t('deaths.statMaternalDeaths'), value: deathStats.maternalDeaths, icon: Skull, color: 'var(--color-danger-text)', bg: 'rgba(224, 49, 39,0.12)' },
                    { label: t('deaths.statUnder5Deaths'), value: deathStats.under5Deaths, icon: AlertTriangle, color: 'var(--color-warning-text)', bg: 'rgba(253, 217, 95,0.12)' },
                    { label: t('vitalStats.neonatalDeaths'), value: deathStats.neonatalDeaths, icon: AlertTriangle, color: 'var(--color-warning-text)', bg: 'rgba(253, 217, 95,0.12)' },
                    { label: t('vitalStats.icd11Coded'), value: `${deathStats.total ? Math.round(deathStats.withICD11Code / deathStats.total * 100) : 0}%`, icon: Activity, color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.12)' },
                  ].map(stat => (
                    <div key={stat.label} className="kpi">
                      <div className="icon-box-sm">
                        <stat.icon style={{ color: stat.color }} />
                      </div>
                      <div className="kpi__body">
                        <div className="kpi__value">{stat.value}</div>
                        <div className="kpi__label">{stat.label}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="card-elevated p-4 mb-6">
                  <h3 className="font-semibold text-sm mb-3">{t('vitalStats.topCausesOfDeath')}</h3>
                  <hr className="section-divider" />
                  <div className="space-y-2 data-row-divider-sm">
                    {deathStats.topCauses.slice(0, 5).map((c, i) => (
                      <div key={c.code} className="flex items-center gap-2">
                        <span className="text-xs font-bold w-5" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(224, 49, 39,0.12)', color: 'var(--color-danger-text)' }}>{c.code}</span>
                        <span className="text-xs flex-1 truncate">{c.cause}</span>
                        <span className="text-sm font-bold">{c.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* CRVS Registration Gaps */}
            {section === 'crvs' && (
              <div className="card-elevated p-4 mb-6">
                <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4" style={{ color: 'var(--color-danger)' }} /> {t('vitalStats.crvsRegistrationGaps')}</h3>
                <hr className="section-divider" />
                <div className="space-y-3 data-row-divider-sm">
                  <div>
                    <div className="flex justify-between text-xs mb-1"><span style={{ color: 'var(--text-secondary)' }}>{t('vitalStats.deathNotificationRate')}</span><span className="font-bold">{deathStats.total ? Math.round(deathStats.notified / deathStats.total * 100) : 0}%</span></div>
                    <div className="w-full h-2 rounded-full" style={{ background: 'var(--overlay-light)' }}><div className="h-full rounded-full" style={{ width: `${deathStats.total ? (deathStats.notified / deathStats.total) * 100 : 0}%`, background: 'var(--color-warning)' }} /></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1"><span style={{ color: 'var(--text-secondary)' }}>{t('vitalStats.deathRegistrationRate')}</span><span className="font-bold">{deathStats.total ? Math.round(deathStats.registered / deathStats.total * 100) : 0}%</span></div>
                    <div className="w-full h-2 rounded-full" style={{ background: 'var(--overlay-light)' }}><div className="h-full rounded-full" style={{ width: `${deathStats.total ? (deathStats.registered / deathStats.total) * 100 : 0}%`, background: 'var(--color-danger)' }} /></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1"><span style={{ color: 'var(--text-secondary)' }}>{t('vitalStats.icd11CodingRate')}</span><span className="font-bold">{deathStats.total ? Math.round(deathStats.withICD11Code / deathStats.total * 100) : 0}%</span></div>
                    <div className="w-full h-2 rounded-full" style={{ background: 'var(--overlay-light)' }}><div className="h-full rounded-full" style={{ width: `${deathStats.total ? (deathStats.withICD11Code / deathStats.total) * 100 : 0}%`, background: 'var(--accent-primary)' }} /></div>
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
