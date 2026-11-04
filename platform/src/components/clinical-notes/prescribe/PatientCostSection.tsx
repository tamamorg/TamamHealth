'use client';

/**
 * Patient Cost — what this prescription will mean for the patient's pocket.
 *
 * The reference shows US insurance eligibility and a discount-card coupon.
 * Neither exists here; the equivalent facts in this system are how the patient
 * is covered (out-of-pocket, a treatment programme, an NGO, or an exemption)
 * and what they already owe, because an outstanding balance is what actually
 * blocks a dispense at the pharmacy window.
 */

import { formatMoney } from '@/lib/format-utils';
import type { PatientDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface PatientCostSectionProps {
  patient: PatientDoc | null;
  /** Ledger balance; null while it is still loading. */
  balance: number | null;
}

function coverageLine(patient: PatientDoc | null): string {
  const payor = patient?.payorInfo;
  if (!payor) return 'No coverage recorded — treated as out-of-pocket.';
  switch (payor.coverageType) {
    case 'program':
      return `Programme: ${payor.programEnrollment || 'enrolled (programme not named)'}`;
    case 'ngo':
      return `NGO cover: ${payor.ngoName || 'not named'}`;
    case 'exemption':
      return `Exempt: ${payor.exemptionReason || 'reason not recorded'}`;
    default:
      return 'Out-of-pocket';
  }
}

export default function PatientCostSection({ patient, balance }: PatientCostSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="cn-rx-cost">
      <div>
        <h4 className="cn-rx-panelhead">{t('labOrder.fieldCoverage')}</h4>
        <p className="cn-rx-panelbody">{coverageLine(patient)}</p>
      </div>
      <div>
        <h4 className="cn-rx-panelhead">{t('ui.accountBalance')}</h4>
        <p className="cn-rx-panelbody">
          {balance === null ? 'Checking…'
            : balance > 0
              ? `${formatMoney(balance)} outstanding — the pharmacy will ask for payment before dispensing.`
              : 'Nothing outstanding.'}
        </p>
      </div>
    </div>
  );
}
