'use client';

/**
 * Tells whoever is prescribing or dispensing a medicine that the US label
 * standard behind the safety checks does not cover it, and lets them flag it.
 *
 * A flag is a staff issue report in the `drug_safety` category, so it lands in
 * the Issues queue the pharmacy lead and administrators already work. It names
 * the medicine and the screen, never the patient: issue reports are read by
 * people outside the patient's care. The queue is open to the roles allowed
 * /inquiries (administrators, the medical superintendent), not pharmacists,
 * because it also holds patient enquiries.
 */

import { useState } from 'react';
import InlineBanner from '@/components/overlay/InlineBanner';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { hasUsLabel, OFF_FORMULARY_CATEGORY, findFormularyDrug } from '@/lib/data/formulary';

export default function UnlabelledDrugNotice({ medication }: { medication: string }) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const name = medication.trim();
  if (!name || hasUsLabel(name)) return null;

  const offList = !findFormularyDrug(name) || findFormularyDrug(name)?.category === OFF_FORMULARY_CATEGORY;
  const flag = async () => {
    if (!currentUser || state === 'sending' || state === 'sent') return;
    setState('sending');
    try {
      const { createIssueReport } = await import('@/modules/communication/services/issue-report-service');
      await createIssueReport({
        summary: t('rxLabel.reportSummary', { name }).slice(0, 140),
        details: t('rxLabel.reportDetails', { name, role: currentUser.role.replace(/_/g, ' ') }),
        category: 'drug_safety',
        severity: 'medium',
        page: typeof window !== 'undefined' ? window.location.pathname : null,
      }, {
        id: currentUser._id,
        name: currentUser.name,
        role: currentUser.role,
        hospitalId: currentUser.hospitalId,
        hospitalName: currentUser.hospitalName,
        orgId: currentUser.orgId,
      });
      setState('sent');
    } catch {
      setState('failed');
    }
  };

  return (
    <InlineBanner
      tone="warning"
      compact
      action={state === 'sent' || !currentUser ? undefined : { label: t('rxLabel.flag'), onClick: () => void flag() }}
    >
      {offList ? t('prescribe.offListNotice') : t('rxLabel.noUsLabel', { name })}
      {state === 'sent' && <> {t('rxLabel.flagged')}</>}
      {state === 'failed' && <> {t('rxLabel.flagFailed')}</>}
    </InlineBanner>
  );
}
