'use client';

/**
 * Chart notice for a cross-organisation referral (referral-service
 * splitPatientAcrossOrgs). On the SENDER's chart: where the patient was
 * referred and that this copy is read-only. On the RECEIVER's chart: where the
 * patient was referred from.
 */
import InlineBanner from '@/components/overlay/InlineBanner';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { localDayOf } from '@/lib/date-utils';
import { isReferredOut } from '@/lib/patient-referral-link';
import type { PatientDoc } from '@/lib/db-types';

const place = (facility?: string, org?: string) => [facility, org].filter(Boolean).join(', ');

export default function ReferralLinkBanner({ patient }: { patient: PatientDoc }) {
  const { t } = useTranslation();
  if (isReferredOut(patient)) {
    const r = patient.referredOut!;
    return (
      <InlineBanner tone="info" title={t('referralLink.outTitle', {
        place: place(r.toHospitalName, r.toOrgName) || t('referralLink.otherOrg'),
        date: localDayOf(r.at),
      })}>
        <p style={{ margin: 0 }}>{t('referralLink.outBody')}</p>
      </InlineBanner>
    );
  }
  if (patient.referredFrom) {
    const r = patient.referredFrom;
    return (
      <InlineBanner tone="info" compact>
        <p style={{ margin: 0 }}>
          {t('referralLink.fromNotice', {
            place: place(r.hospitalName, r.orgName) || t('referralLink.otherOrg'),
            date: localDayOf(r.at),
          })}
        </p>
      </InlineBanner>
    );
  }
  return null;
}
