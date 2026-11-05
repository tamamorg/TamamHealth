'use client';

/**
 * Vital statistics: births and deaths as national figures, plus the CRVS
 * (civil registration and vital statistics) gaps. The Reports hub tab names
 * the page, so there is no title row; the section list picks the view.
 * The aggregates carry no earlier period, so the tiles state what they are
 * made of and show no trend.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useVitalStatistics } from '@/lib/hooks/useVitalStatistics';
import { Baby, Skull, AlertTriangle } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { SadbCard, SadbKpiTile } from '@/components/admin/sadb-ui';

type SectionId = 'births' | 'mortality' | 'crvs';

function RateBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between mb-1" style={{ fontSize: 14 }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontWeight: 600 }}>{pct}%</span>
      </div>
      <div className="w-full h-2 rounded-full" style={{ background: 'var(--overlay-light)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export default function VitalStatisticsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data, loading } = useVitalStatistics();
  const [section, setSection] = useState<SectionId>('births');

  if (loading || !data) return <main className="page-container flex items-center justify-center"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('vitalStats.loading')}</p></main>;

  const { birthStats, deathStats } = data;
  const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

  const sections: { id: SectionId; label: string; icon: typeof Baby; count?: number }[] = [
    { id: 'births', label: t('vitalStats.birthStatistics'), icon: Baby, count: birthStats.total },
    { id: 'mortality', label: t('vitalStats.mortalityStatistics'), icon: Skull, count: deathStats.total },
    { id: 'crvs', label: t('vitalStats.crvsRegistrationGaps'), icon: AlertTriangle },
  ];

  return (
    <main className="page-container page-enter sadb-scope">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <aside style={{ width: 224, flexShrink: 0 }}>
          <nav className="ehr-set-nav" aria-label={t('ui.vitalStatisticsSections')} data-tour="vs-section-nav">
            {sections.map(item => {
              const Icon = item.icon;
              return (
                <button key={item.id} type="button" className={section === item.id ? 'active' : undefined} onClick={() => setSection(item.id)}>
                  <Icon />
                  <em>{item.label}</em>
                  {item.count !== undefined && <b>{item.count}</b>}
                </button>
              );
            })}
          </nav>
        </aside>

        <section style={{ flex: 1, minWidth: 0 }} className="sadb-page">
          {section === 'births' && (
            <>
              <div className="sadb-kpi-row">
                <SadbKpiTile label={t('vitalStats.totalBirths')} value={birthStats.total.toLocaleString()} delta={t('vitalStats.detailBirthsTotal')} onClick={() => router.push('/births')} />
                <SadbKpiTile label={t('births.statThisMonth')} value={birthStats.thisMonth.toLocaleString()} delta={t('vitalStats.detailBirthsMonth')} onClick={() => router.push('/births')} />
                <SadbKpiTile label={t('vitalStats.maleBirths')} value={birthStats.byGender.male.toLocaleString()} delta={t('vitalStats.detailShareOfBirths', { pct: pct(birthStats.byGender.male, birthStats.total) })} />
                <SadbKpiTile label={t('vitalStats.femaleBirths')} value={birthStats.byGender.female.toLocaleString()} delta={t('vitalStats.detailShareOfBirths', { pct: pct(birthStats.byGender.female, birthStats.total) })} />
                <SadbKpiTile label={t('births.statCaesareanRate')} value={`${pct(birthStats.byDeliveryType.caesarean, birthStats.total)}%`} delta={t('vitalStats.detailCaesarean', { n: birthStats.byDeliveryType.caesarean.toLocaleString(), total: birthStats.total.toLocaleString() })} />
              </div>

              {Object.keys(birthStats.byState).length > 0 && (
                <SadbCard title={t('vitalStats.birthsByState')} meta={t('vitalStats.metaRegisteredBirths')}>
                  <div className="p-4 space-y-2">
                    {Object.entries(birthStats.byState).sort(([, a], [, b]) => b - a).map(([state, count]) => (
                      <div key={state} className="flex items-center gap-3">
                        <span className="w-48 truncate" style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{state}</span>
                        <div className="flex-1 h-2 rounded-full" style={{ background: 'var(--overlay-light)' }}>
                          <div className="h-full rounded-full" style={{ width: `${birthStats.total > 0 ? (count / birthStats.total) * 100 : 0}%`, background: 'var(--accent-primary)' }} />
                        </div>
                        <span className="w-8 text-end" style={{ fontSize: 14, fontWeight: 600 }}>{count}</span>
                      </div>
                    ))}
                  </div>
                </SadbCard>
              )}
            </>
          )}

          {section === 'mortality' && (
            <>
              <div className="sadb-kpi-row">
                <SadbKpiTile label={t('deaths.statTotalDeaths')} value={deathStats.total.toLocaleString()} delta={t('vitalStats.detailDeathsTotal')} onClick={() => router.push('/deaths')} />
                <SadbKpiTile label={t('deaths.statMaternalDeaths')} value={deathStats.maternalDeaths.toLocaleString()} delta={t('vitalStats.detailMaternal')} deltaTone={deathStats.maternalDeaths > 0 ? 'warn' : undefined} onClick={() => router.push('/deaths')} />
                <SadbKpiTile label={t('deaths.statUnder5Deaths')} value={deathStats.under5Deaths.toLocaleString()} delta={t('vitalStats.detailUnder5')} onClick={() => router.push('/deaths')} />
                <SadbKpiTile label={t('vitalStats.neonatalDeaths')} value={deathStats.neonatalDeaths.toLocaleString()} delta={t('vitalStats.detailNeonatal')} onClick={() => router.push('/deaths')} />
                <SadbKpiTile label={t('vitalStats.icd11Coded')} value={`${pct(deathStats.withICD11Code, deathStats.total)}%`} delta={t('vitalStats.detailIcd', { n: deathStats.withICD11Code.toLocaleString(), total: deathStats.total.toLocaleString() })} />
              </div>

              <SadbCard title={t('vitalStats.topCausesOfDeath')} meta={t('vitalStats.metaCauses')}>
                <div className="p-4 space-y-2">
                  {deathStats.topCauses.slice(0, 5).map((c, i) => (
                    <div key={c.code} className="flex items-center gap-3" style={{ fontSize: 14 }}>
                      <span className="w-5" style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{i + 1}</span>
                      <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 12, background: 'var(--color-danger-bg)', color: 'var(--color-danger-text)' }}>{c.code}</span>
                      <span className="flex-1 truncate">{c.cause}</span>
                      <span style={{ fontWeight: 600 }}>{c.count}</span>
                    </div>
                  ))}
                </div>
              </SadbCard>
            </>
          )}

          {section === 'crvs' && (
            <SadbCard title={t('vitalStats.crvsRegistrationGaps')} meta={t('vitalStats.metaDeathsOnRecord', { n: deathStats.total.toLocaleString() })}>
              <div className="p-4 space-y-4">
                <RateBar label={t('vitalStats.deathNotificationRate')} pct={pct(deathStats.notified, deathStats.total)} color="var(--color-warning)" />
                <RateBar label={t('vitalStats.deathRegistrationRate')} pct={pct(deathStats.registered, deathStats.total)} color="var(--color-danger)" />
                <RateBar label={t('vitalStats.icd11CodingRate')} pct={pct(deathStats.withICD11Code, deathStats.total)} color="var(--accent-primary)" />
              </div>
            </SadbCard>
          )}
        </section>
      </div>
    </main>
  );
}
