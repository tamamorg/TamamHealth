'use client';

/**
 * The embedded widget.
 *
 * Same `BookingFlow` as everywhere else — the point of the embed is a
 * different *frame*, not a different booking experience. What it adds is the
 * provider chooser (the practice page's grid is too wide for a sidebar iframe)
 * and the `postMessage` handshake that lets the host page size the frame to
 * the content instead of guessing.
 */

import { useEffect, useRef, useState } from 'react';
import type { PracticePayload, PublicProvider } from '@/lib/booking/public-client';
import { BookingSelect, Field, ProviderAvatar } from './primitives';
import BookingFlow from './BookingFlow';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function EmbedBooking({ data }: { data: PracticePayload }) {
  const { t } = useTranslation();
  const { practice, policy, providers, reasons } = data;
  const [providerId, setProviderId] = useState(providers[0]?.id ?? '');
  const rootRef = useRef<HTMLDivElement>(null);

  const provider: PublicProvider | undefined =
    providers.find(p => p.id === providerId) ?? providers[0];

  // Tell the host page how tall we are, so the iframe can size itself. Without
  // it the practice has to hard-code a height and the form is either clipped
  // or sitting in a field of white space.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof window === 'undefined' || window.parent === window) return;
    const post = () => {
      window.parent.postMessage(
        { source: 'tamamhealth-booking', type: 'resize', height: el.scrollHeight },
        '*',
      );
    };
    post();
    const ro = new ResizeObserver(post);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!provider) {
    return (
      <div className="booking-page" ref={rootRef}>
        <p className="booking-empty-note">
          {t('ui.thisPracticeHasNoClinicians')}
        </p>
      </div>
    );
  }

  return (
    <div className="booking-page" ref={rootRef}>
      {providers.length > 1 && (
        <div style={{ marginBottom: 12 }}>
          <Field label={t('ui.clinician')}>
            <BookingSelect value={providerId} onChange={setProviderId} ariaLabel="Clinician">
              {providers.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </BookingSelect>
          </Field>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <ProviderAvatar name={provider.displayName} photoUrl={provider.photoUrl} />
        <div className="booking-summary-meta">
          <b>{provider.displayName}</b>
          <span>{provider.specialtyLabel || practice.name}</span>
        </div>
      </div>

      <BookingFlow
        practiceSlug={practice.slug}
        practiceName={practice.name}
        policy={policy}
        reasons={reasons}
        provider={provider}
      />
    </div>
  );
}
