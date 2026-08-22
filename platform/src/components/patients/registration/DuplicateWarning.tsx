'use client';

/**
 * "This person may already have a record."
 *
 * Shown on the Review step, which is the one moment the clerk is checking the
 * form against the person standing at the desk — early enough that nothing has
 * been written, late enough that the name and locality are actually filled in.
 *
 * It does not block submission, and there is no "merge" button. Twins share a
 * surname, an age and a county; a household can hold two people with one name;
 * and the clerk can see the patient while this component cannot. So it states
 * what matched and offers the existing chart to look at — the judgement stays
 * with the person who has the information to make it.
 */

import { AlertTriangle } from '@/components/icons/lucide';
import type { DuplicateMatch, DuplicateReason } from '@/lib/patients/duplicate-match';
import { patientAgeLabel } from '@/lib/patient-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';

export interface DuplicateWarningProps {
  matches: DuplicateMatch[];
  /** Open an existing chart. The caller decides whether that leaves the form. */
  onOpen: (patientId: string) => void;
}

export default function DuplicateWarning({ matches, onOpen }: DuplicateWarningProps) {
  const { t } = useTranslation();
  if (matches.length === 0) return null;

  const reasonLabel = (reason: DuplicateReason): string => {
    switch (reason.code) {
      case 'name-exact': return t('patientNew.dupSameName');
      case 'name-similar': return t('patientNew.dupSimilarName');
      case 'age-same': return t('patientNew.dupSameAge', { years: reason.years });
      case 'age-near': return t('patientNew.dupNearAge', { gap: reason.gap });
      case 'same-county': return t('patientNew.dupSameCounty', { place: reason.place });
      case 'same-state': return t('patientNew.dupSameState', { place: reason.place });
      case 'hospital-number': return t('patientNew.dupHospitalNumber', { number: reason.number });
    }
  };

  return (
    <section className="reg-dup" aria-live="polite">
      <header className="reg-dup-head">
        <AlertTriangle className="reg-dup-icon" aria-hidden />
        <div>
          <h3>{matches.length === 1 ? t('patientNew.dupTitleOne') : t('patientNew.dupTitleMany', { count: matches.length })}</h3>
          <p>{t('patientNew.dupBody')}</p>
        </div>
      </header>

      <ul className="reg-dup-list">
        {matches.map(match => (
          <li key={match.patient._id} className={`reg-dup-row${match.strength === 'strong' ? ' is-strong' : ''}`}>
            <div className="reg-dup-who">
              <strong>{match.name}</strong>
              <span>{[match.patient.gender, patientAgeLabel(match.patient), match.patient.county].filter(Boolean).join(' · ')}</span>
            </div>
            <ul className="reg-dup-reasons">
              {match.reasons.map(reason => <li key={reason.code}>{reasonLabel(reason)}</li>)}
            </ul>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onOpen(match.patient._id)}
            >
              {t('patientNew.dupOpenRecord')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
