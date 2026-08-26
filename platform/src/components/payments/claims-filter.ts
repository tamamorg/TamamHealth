import type { FilterOption } from '@/components/filters';
import type { ClaimDoc, ClaimStatus, PayerType } from '@/lib/db-types-payments';

export const PAYER_LABEL_KEYS: Record<PayerType, string> = {
  self_pay: 'billing.payerSelfPay',
  nhis: 'billing.payerNhis',
  cbhi: 'billing.payerCbhi',
  donor: 'billing.payerDonor',
  government: 'billing.payerGovernment',
  private: 'billing.payerPrivate',
  employer: 'billing.payerEmployer',
};

const CLAIM_STATUSES: ClaimStatus[] = ['draft', 'submitted', 'accepted', 'partial', 'paid', 'denied', 'appealed'];

export function filterClaims(
  claims: ClaimDoc[],
  { search, status, payer }: { search: string; status: string; payer: string },
): ClaimDoc[] {
  const q = search.trim().toLowerCase();
  return claims.filter(claim => {
    if (status !== 'all' && claim.status !== status) return false;
    if (payer !== 'all' && claim.payerType !== payer) return false;
    if (!q) return true;
    return (claim.claimNumber || '').toLowerCase().includes(q)
      || (claim.patientName || '').toLowerCase().includes(q)
      || (claim.payerName || '').toLowerCase().includes(q);
  });
}

export function claimFilterOptions(claims: ClaimDoc[], t: (key: string) => string): {
  status: FilterOption[];
  payer: FilterOption[];
} {
  return {
    status: [
      { value: 'all', label: `All statuses (${claims.length})` },
      ...CLAIM_STATUSES.map(status => ({
        value: status,
        label: `${t(`claims.status_${status}`)} (${claims.filter(claim => claim.status === status).length})`,
      })),
    ],
    payer: [
      { value: 'all', label: 'All payers' },
      ...Array.from(new Set(claims.map(claim => claim.payerType)))
        .map(payer => ({ value: payer, label: t(PAYER_LABEL_KEYS[payer]) || payer })),
    ],
  };
}
