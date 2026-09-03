'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';
import { Pencil } from '@/components/icons/lucide';
import FingerprintCapture, { type CapturedFingerprint } from '@/components/FingerprintCapture';

export interface BiometricsSectionProps {
  photoUrl: string | null;
  onEditPhoto: () => void;
  onClearPhoto: () => void;
  fingerprints: CapturedFingerprint[];
  onFingerprintsChange: (next: CapturedFingerprint[]) => void;
}

/**
 * The patient's photo and fingerprints. Nothing here is required, and nothing
 * here is validated — it collects identifiers rather than facts.
 */
export default function BiometricsSection({
  photoUrl, onEditPhoto, onClearPhoto, fingerprints, onFingerprintsChange,
}: BiometricsSectionProps) {
  const { t } = useTranslation();
  return (
    <>
      <p className="registration-section-note">{t('patientNew.biometricsNote')}</p>

      <div className="registration-inline-panel registration-inline-panel--media">
        <div className="registration-panel-heading">
          <h4>{t('patientNew.patientPhotoHeading')}</h4>
          <span>{t('patientNew.optionalLabel')}</span>
        </div>
        {/* The Tamam photo well: a plain bordered square holding the picture
            (or the words that stand in for it), with one dark action bar
            welded to its foot. The bar IS the button — there is no separate
            "Take photo" control beside it. */}
        <div className="registration-media-row">
          <div className="tamam-reg-photo">
            <div className="tamam-reg-photo-frame">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt={t('patientNew.photoAlt')} />
              ) : (
                <span className="tamam-reg-photo-empty">{t('patientNew.noImageToDisplay')}</span>
              )}
            </div>
            <button
              type="button"
              onClick={onEditPhoto}
              className="tamam-reg-photo-edit"
              aria-label={photoUrl ? t('patientNew.retakePhoto') : t('patientNew.takePhoto')}
            >
              <span>{t('action.edit')}</span>
              <Pencil className="w-4 h-4" aria-hidden />
            </button>
          </div>
          <div className="tamam-reg-photo-aside">
            <p>{t('patientNew.photoHelp')}</p>
            {photoUrl && (
              <button type="button" onClick={onClearPhoto} className="tamam-reg-photo-remove">
                {t('action.remove')}
              </button>
            )}
          </div>
        </div>
      </div>

      <FingerprintCapture value={fingerprints} onChange={onFingerprintsChange} />
    </>
  );
}
