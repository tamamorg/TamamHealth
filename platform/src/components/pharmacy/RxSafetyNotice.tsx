'use client';

/**
 * What the pharmacist has to see before handing a medicine over: the warnings
 * standing when it was prescribed, the prescriber's written justification, and
 * any allergy conflict nobody has answered yet, with the field for answering it.
 */

import { useEffect, useState } from 'react';
import InlineBanner from '@/components/overlay/InlineBanner';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { unreviewedAllergyConflicts } from '@/lib/pharmacy/rx-safety';
import type { StructuredAllergyAlert } from '@/lib/services/drug-interaction-service';
import type { PrescriptionDoc } from '@/lib/db-types';

/** Allergy conflicts on this order that still need the pharmacist's review. */
export function useUnreviewedAllergies(rx: PrescriptionDoc): StructuredAllergyAlert[] {
  const scope = useDataScope();
  const [conflicts, setConflicts] = useState<StructuredAllergyAlert[]>([]);
  useEffect(() => {
    if (!scope || !rx.patientId) return;
    let live = true;
    void (async () => {
      const { getActiveAllergies } = await import('@/lib/services/allergy-service');
      const active = await getActiveAllergies(rx.patientId, scope).catch(() => []);
      if (live) setConflicts(unreviewedAllergyConflicts(rx, active));
    })();
    return () => { live = false; };
  }, [rx, scope]);
  return conflicts;
}

export default function RxSafetyNotice({ rx, conflicts = [], review, onReview }: {
  rx: PrescriptionDoc;
  conflicts?: StructuredAllergyAlert[];
  /** With `onReview`, shows the field for a written review of `conflicts`. */
  review?: string;
  onReview?: (value: string) => void;
}) {
  const { t } = useTranslation();
  const safety = rx.medicationSafety;
  const lines = [
    ...conflicts.map(c => t('rxFlow.newAllergyConflict', { allergy: c.allergy })),
    ...(safety?.allergyWarnings || []).map(w => t('rxFlow.safetyAllergy', {
      allergy: w.allergy, criticality: w.criticality, reaction: w.reaction ? `, ${w.reaction}` : '',
    })),
    ...(safety?.interactionWarnings || []).map(i => t('rxFlow.safetyInteraction', {
      drugs: `${i.drug1} + ${i.drug2}`, severity: i.severity, advice: i.clinicalAdvice,
    })),
    ...(safety?.duplicateWarnings || []).map(medication => t('rxFlow.safetyDuplicate', { medication })),
    ...(safety?.acknowledgement ? [t('rxFlow.safetyJustified', { name: safety.acknowledgement.reviewedBy, reason: safety.acknowledgement.reason })] : []),
    ...(rx.dispenseAllergyReview ? [t('rxFlow.safetyPharmacistReview', { name: rx.dispenseAllergyReview.reviewedBy, reason: rx.dispenseAllergyReview.reason })] : []),
  ];
  if (!lines.length) return null;
  return (
    <div className="rx-safety-notice" style={{ marginBottom: 12 }}>
      <InlineBanner tone={conflicts.length ? 'danger' : 'warning'} title={t('rxFlow.safetyHeading')}>
        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
          {lines.map((line, index) => <li key={index}>{line}</li>)}
        </ul>
      </InlineBanner>
      {conflicts.length > 0 && onReview && (
        <div className="labord-form" style={{ marginTop: 10 }}>
          <label className="labord-field-label" htmlFor={`rx-allergy-review-${rx._id}`}>{t('rxFlow.allergyReviewLabel')}</label>
          <textarea
            id={`rx-allergy-review-${rx._id}`}
            className="labord-x"
            rows={2}
            value={review || ''}
            onChange={event => onReview(event.target.value)}
          />
        </div>
      )}
    </div>
  );
}
