'use client';

/**
 * S1/S2/S3 — a clinician's public profile with the booking rail beside it.
 *
 * The rail *replaces itself* as the patient moves through the flow rather than
 * opening a dialog over the page. That is the behaviour in the reference and
 * it is the right one: the profile is the context for the decision, so it
 * should stay legible while the decision is being made.
 *
 * The rating block is deliberately absent. Reviews are a later, gated phase —
 * placeholder stars on a real clinician's public page would be a fabrication.
 */

import { useMemo, useState } from 'react';
import type { ProviderPayload } from '@/lib/booking/public-client';
import { CallNowCard, ProviderAvatar } from './primitives';
import BookingFlow from './BookingFlow';
import { useTranslation } from '@/lib/i18n/useTranslation';

type TabKey = 'about' | 'services' | 'locations';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'about', label: 'About' },
  { key: 'services', label: 'Services' },
  { key: 'locations', label: 'Locations' },
];

export default function ProviderProfile({ data }: { data: ProviderPayload }) {
  const { t } = useTranslation();
  const { practice, policy, provider, locations, reasons } = data;
  const [tab, setTab] = useState<TabKey>('about');

  const primary = locations[0];
  const extraLocations = Math.max(0, locations.length - 1);

  const languages = useMemo(
    () => provider.languages.filter(Boolean),
    [provider.languages],
  );

  return (
    <div className="booking-page">
      <div className="booking-profile-grid">
        <div>
          <div className="booking-profile-head">
            <ProviderAvatar
              name={provider.displayName}
              photoUrl={provider.photoUrl}
              className="booking-profile-photo"
            />
            <div style={{ minWidth: 0 }}>
              <h1 className="booking-profile-name">{provider.displayName}</h1>
              <p className="booking-profile-specialty">{provider.specialtyLabel}</p>
              {primary && (
                <p className="booking-profile-address">
                  {primary.name}<br />
                  {[primary.town, primary.state].filter(Boolean).join(', ')}
                  {extraLocations > 0 && (
                    <>
                      {' '}
                      <button type="button" className="booking-linkish" onClick={() => setTab('locations')}>
                        +{extraLocations} {t('ui.moreLocation')}{extraLocations > 1 ? 's' : ''}
                      </button>
                    </>
                  )}
                </p>
              )}
              {!provider.acceptingNewPatients && (
                <p className="booking-hint" style={{ marginTop: 8 }}>
                  {t('ui.notCurrentlyAcceptingNewPatients')}
                </p>
              )}
            </div>
          </div>

          <nav className="booking-tabs" aria-label={t('ui.providerInformation')}>
            {TABS.map(t => (
              <button
                key={t.key}
                type="button"
                className={tab === t.key ? 'is-active' : undefined}
                aria-current={tab === t.key ? 'page' : undefined}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {tab === 'about' && (
            <section className="booking-section">
              <h2>{t('landing.footer.about')}</h2>
              <p>{provider.bio || `${provider.displayName} practises at ${practice.name}.`}</p>
              {languages.length > 0 && (
                <>
                  <h2 style={{ marginTop: 20 }}>{t('ui.languages')}</h2>
                  <div className="booking-chips">
                    {languages.map(l => <span key={l} className="booking-chip">{l}</span>)}
                  </div>
                </>
              )}
            </section>
          )}

          {tab === 'services' && (
            <section className="booking-section">
              <h2>{t('ui.services')}</h2>
              {reasons.length === 0
                ? <p>{t('ui.nothingIsBookableOnlineWith')}</p>
                : (
                  <div className="booking-chips">
                    {reasons.map(r => (
                      <span key={r.id} className="booking-chip">
                        {r.name} · {r.durationMinutes} min
                      </span>
                    ))}
                  </div>
                )}
            </section>
          )}

          {tab === 'locations' && (
            <section className="booking-section">
              <h2>{t('ui.locations')}</h2>
              {locations.length === 0
                ? <p>{t('ui.noPublishedLocations')}</p>
                : locations.map(l => (
                  <p key={l.id} style={{ marginBottom: 10 }}>
                    <b>{l.name}</b><br />
                    {[l.town, l.state].filter(Boolean).join(', ')}
                  </p>
                ))}
            </section>
          )}
        </div>

        <aside className="booking-rail">
          <BookingFlow
            practiceSlug={practice.slug}
            practiceName={practice.name}
            policy={policy}
            reasons={reasons}
            provider={provider}
          />
          <CallNowCard practiceName={provider.displayName} phone={policy.publicPhone || practice.phone} />
        </aside>
      </div>
    </div>
  );
}
