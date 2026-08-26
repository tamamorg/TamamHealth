'use client';

/**
 * Add insurance policy, full-page — where the policy popup's Expand control
 * lands, from the chart's Billing tab.
 *
 * `?policy=` carries the edit case. The popup is the same component either
 * way, so the page loads the patient's policies and hands it the one the
 * operator had open rather than forking a second editor.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import CreateRecordPage from '@/components/create-dialogs/CreateRecordPage';
import InsurancePolicyModal from '@/components/payments/InsurancePolicyModal';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useReturnTo } from '@/lib/navigation/expand-to-page';
import { getPatientInsurancePolicies } from '@/lib/services/payment-service';
import type { InsurancePolicyDoc } from '@/lib/db-types-payments';
import { useDataScope } from '@/lib/hooks/useDataScope';

export default function NewInsurancePolicyPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const patientId = params?.id ?? '';
  const chart = `/patients/${encodeURIComponent(patientId)}?tab=billing`;
  const returnTo = useReturnTo(chart);

  const [policy, setPolicy] = useState<InsurancePolicyDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const policyId = new URLSearchParams(window.location.search).get('policy');
    if (!policyId || !patientId || !scope) { setLoading(false); return; }
    (async () => {
      try {
        const policies = await getPatientInsurancePolicies(patientId, scope);
        if (!cancelled) setPolicy(policies.find(p => p._id === policyId) ?? null);
      } catch (err) {
        console.error('[insurance] could not load the policy being edited:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [patientId, scope]);

  // The form seeds its fields from `policy` on first render, so it must not
  // mount until that lookup has settled — otherwise an edit opens empty.
  if (loading) return null;

  return (
    <CreateRecordPage
      title={policy
        ? (t('billing.editInsurance') || 'Edit insurance policy')
        : (t('billing.addInsurance') || 'Add insurance policy')}
      note={t('createPage.insuranceNote')}
      backLabel={t('createPage.backToChart')}
      returnTo={returnTo}
    >
      <InsurancePolicyModal
        presentation="page"
        patientId={patientId}
        policy={policy}
        facilityId={currentUser?.hospitalId ?? ''}
        orgId={currentUser?.orgId}
        createdBy={currentUser?._id}
        onClose={() => router.push(returnTo)}
        onSaved={() => router.push(chart)}
      />
    </CreateRecordPage>
  );
}
