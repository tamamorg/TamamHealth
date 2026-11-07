import { Check } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { PatientDoc } from '@/lib/db-types';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import { dobWithAge, nameInitials } from '../helpers';

/** Whose note: the O3 patient banner at the head of the workspace form. */
export function NotePatientBanner({ bannerName, patient, note }: {
  bannerName: string;
  patient: PatientDoc | null;
  note: ClinicalNoteDoc;
}) {
  const { t } = useTranslation();
  return (
    <div className="omf-banner">
      <span className="omf-banner-avatar" aria-hidden>{nameInitials(bannerName)}</span>
      <div className="omf-banner-text">
        <div className="omf-banner-name">
          <strong>{bannerName}</strong>
          {patient?.gender && <span className="omf-banner-sex">{patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1)}</span>}
        </div>
        <div className="omf-banner-line">
          {dobWithAge(patient?.dateOfBirth || note.patientDob) && <span>{dobWithAge(patient?.dateOfBirth || note.patientDob)}</span>}
          {(patient?.hospitalNumber || note.mrn) && <span className="omf-banner-id">{t('noteEditor.patientId')}: <strong>{patient?.hospitalNumber || note.mrn}</strong></span>}
        </div>
      </div>
    </div>
  );
}

/** The "awaiting co-signature" / "signed" banners shown above a locked note. */
export function NoteLockBanners({ note, awaitingCosign, signedFinal }: {
  note: ClinicalNoteDoc;
  awaitingCosign: boolean;
  signedFinal: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {awaitingCosign && (
        <div className="cn-locked-banner">
          <Check size={15} />
          <span>
            {t('noteEditor.awaitingCosignBanner', {
              signer: note.signedByName || '',
              date: new Date(note.signedAt || '').toLocaleString(),
              requested: note.cosignRequestedName || t('noteEditor.aSupervisor'),
            })}
          </span>
        </div>
      )}
      {signedFinal && (
        <div className="cn-locked-banner">
          <Check size={15} />
          <span>
            {t('noteEditor.signedBanner', {
              signer: note.signedByName || '',
              date: new Date(note.signedAt || '').toLocaleString(),
            })}
            {note.cosignedByName ? ` ${t('noteEditor.cosignedBy', { name: note.cosignedByName })}` : ''}
          </span>
        </div>
      )}
    </>
  );
}
