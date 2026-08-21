'use client';

/**
 * Insurance-claims queue — the table, filters, row actions and lifecycle
 * modals that used to be the standalone /payments/claims page.
 *
 * It now renders as one tab of the merged Billing & Claims workspace
 * (`BillingWorkspace`), which owns the claim docs and reloads them after any
 * lifecycle change. Everything claim-specific still lives here so the
 * workspace stays a shell: submit, adjudicate, appeal, resubmit.
 *
 * Access is still gated upstream — /payments/claims is an explicit-grant route
 * (a cashier reaches /payments but not claims), so the workspace only mounts
 * this panel for roles that hold the grant.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, X } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import type { FilterOption } from '@/components/filters';
import { useApp } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { usePatients } from '@/lib/hooks/usePatients';
import { patientFullName, shortenPersonName } from '@/lib/patient-utils';
import { computeAdjudicatedStatus } from '@/lib/services/payment-service';
import type { ClaimDoc, ClaimStatus, PayerType, InsurancePolicyDoc } from '@/lib/db-types-payments';
import type { BillingDoc } from '@/lib/db-types-billing';
import { formatMoney } from '@/lib/format-utils';

export const PAYER_LABEL_KEYS: Record<PayerType, string> = {
  self_pay: 'billing.payerSelfPay',
  nhis: 'billing.payerNhis',
  cbhi: 'billing.payerCbhi',
  donor: 'billing.payerDonor',
  government: 'billing.payerGovernment',
  private: 'billing.payerPrivate',
  employer: 'billing.payerEmployer',
};

// Claim status → bl-chip variant. Claim statuses are their own union (not
// BillingStatus), so this maps onto the closest billing-module chip meaning:
// draft (not yet sent) reads as neutral, submitted/appealed as pending,
// accepted/paid as settled, denied as the alarm colour.
const CLAIM_STATUS_CHIP: Record<ClaimStatus, string> = {
  draft: 'bl-chip--waived',
  submitted: 'bl-chip--partial',
  accepted: 'bl-chip--paid',
  denied: 'bl-chip--unpaid',
  paid: 'bl-chip--paid',
  appealed: 'bl-chip--partial',
  partial: 'bl-chip--partial',
};

const CLAIM_STATUSES: ClaimStatus[] = ['draft', 'submitted', 'accepted', 'partial', 'paid', 'denied', 'appealed'];

interface AdjudicationForm {
  claimId: string;
  allowedAmount: number;
  paidAmount: number;
  denialReason?: string;
  notes: string;
}

interface NewClaimForm {
  patientId: string;
  policyId: string;
  billingId: string;
  amount: string;
}

const EMPTY_CLAIM: NewClaimForm = { patientId: '', policyId: '', billingId: '', amount: '' };

/**
 * Filters a claim list the same way the panel does — exported so the
 * workspace's CSV export writes exactly the rows on screen.
 */
export function filterClaims(
  claims: ClaimDoc[],
  { search, status, payer }: { search: string; status: string; payer: string },
): ClaimDoc[] {
  const q = search.trim().toLowerCase();
  return claims.filter(c => {
    if (status !== 'all' && c.status !== status) return false;
    if (payer !== 'all' && c.payerType !== payer) return false;
    if (!q) return true;
    return (c.claimNumber || '').toLowerCase().includes(q)
      || (c.patientName || '').toLowerCase().includes(q)
      || (c.payerName || '').toLowerCase().includes(q);
  });
}

export interface ClaimsPanelProps {
  claims: ClaimDoc[];
  /** Rows to render — already filtered by the workspace toolbar. */
  visibleClaims: ClaimDoc[];
  /** Reload the workspace's docs after a lifecycle change. */
  onChanged: () => void | Promise<void>;
  /** "New claim" is launched from the workspace's Actions menu too. */
  newClaimOpen: boolean;
  setNewClaimOpen: (open: boolean) => void;
}

/** Claim queue columns, in order. Widths are equal by layout. */
const CLAIM_COLUMNS = [
  { key: 'claims.colClaimNumber', align: 'left' as const },
  { key: 'claims.colPatientName', align: 'left' as const },
  { key: 'claims.colPayerName', align: 'left' as const },
  { key: 'claims.colPayerType', align: 'left' as const },
  { key: 'claims.colBilled', align: 'right' as const },
  { key: 'claims.colAllowed', align: 'right' as const },
  { key: 'claims.colPaid', align: 'right' as const },
  { key: 'claims.colStatus', align: 'left' as const },
  { key: 'claims.colSubmittedDate', align: 'left' as const },
] as const;

export default function ClaimsPanel({ claims, visibleClaims, onChanged, newClaimOpen, setNewClaimOpen }: ClaimsPanelProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useApp();
  const { showToast } = useToast();
  const { patients } = usePatients();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adjForm, setAdjForm] = useState<AdjudicationForm | null>(null);
  // The row popup. Held by id, not by doc, so the panel keeps showing live
  // amounts after an adjudication reloads the queue underneath it.
  const [openClaimId, setOpenClaimId] = useState<string | null>(null);
  const openClaim = useMemo(
    () => (openClaimId ? claims.find(c => c._id === openClaimId) || null : null),
    [openClaimId, claims],
  );
  const setOpenClaim = (claim: ClaimDoc | null) => setOpenClaimId(claim?._id ?? null);

  // Appeal modal (denied claim → appealed, with a note).
  const [appealFor, setAppealFor] = useState<ClaimDoc | null>(null);
  const [appealNote, setAppealNote] = useState('');
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  // "New claim" — the UI path that actually creates a ClaimDoc.
  const [newClaim, setNewClaim] = useState<NewClaimForm>(EMPTY_CLAIM);
  const [patientSearch, setPatientSearch] = useState('');
  const [patientPolicies, setPatientPolicies] = useState<InsurancePolicyDoc[]>([]);
  const [patientBills, setPatientBills] = useState<BillingDoc[]>([]);
  const [submittingClaim, setSubmittingClaim] = useState(false);

  const scope = useMemo(
    () => (currentUser
      ? { orgId: currentUser.orgId, hospitalId: currentUser.hospitalId, role: currentUser.role }
      : undefined),
    [currentUser],
  );

  // When a patient is picked in the New-claim modal, load their insurance
  // policies and open bills so the claim can be raised against real data.
  useEffect(() => {
    if (!newClaim.patientId) { setPatientPolicies([]); setPatientBills([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const [{ getPatientInsurancePolicies }, { getAllBills }] = await Promise.all([
          import('@/lib/services/payment-service'),
          import('@/lib/services/billing-service'),
        ]);
        const [policies, bills] = await Promise.all([
          getPatientInsurancePolicies(newClaim.patientId),
          getAllBills(scope),
        ]);
        if (cancelled) return;
        setPatientPolicies(policies);
        setPatientBills(bills.filter(b => b.patientId === newClaim.patientId && (b.balanceDue ?? 0) > 0));
      } catch (err) {
        console.error('Failed to load patient billing context:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [newClaim.patientId, scope]);

  const handleAppeal = async () => {
    if (!appealFor || !appealNote.trim()) { showToast('An appeal needs a note for the payer', 'error'); return; }
    setLifecycleBusy(true);
    try {
      const { appealClaim } = await import('@/lib/services/payment-service');
      await appealClaim(appealFor._id, appealNote.trim(), currentUser?._id || 'unknown', currentUser?.name || 'Unknown');
      showToast(`Claim ${appealFor.claimNumber} appealed`, 'success');
      setAppealFor(null);
      setAppealNote('');
      await onChanged();
    } catch (err) {
      console.error(err);
      showToast((err as Error).message || 'Could not appeal this claim', 'error');
    } finally {
      setLifecycleBusy(false);
    }
  };

  const handleResubmit = async (claim: ClaimDoc) => {
    setLifecycleBusy(true);
    try {
      const { resubmitClaim } = await import('@/lib/services/payment-service');
      await resubmitClaim(claim._id, currentUser?._id || 'unknown', currentUser?.name || 'Unknown');
      showToast(`Claim ${claim.claimNumber} resubmitted to ${claim.payerName}`, 'success');
      await onChanged();
    } catch (err) {
      console.error(err);
      showToast((err as Error).message || 'Could not resubmit this claim', 'error');
    } finally {
      setLifecycleBusy(false);
    }
  };

  const resetNewClaim = () => {
    setNewClaim(EMPTY_CLAIM);
    setPatientSearch('');
    setNewClaimOpen(false);
  };

  const handleSubmitNewClaim = async () => {
    const policy = patientPolicies.find(p => p._id === newClaim.policyId);
    const patient = patients.find(p => p._id === newClaim.patientId);
    const bill = patientBills.find(b => b._id === newClaim.billingId);
    const amount = bill ? (bill.balanceDue ?? bill.totalAmount ?? 0) : parseFloat(newClaim.amount);
    if (!patient) { showToast('Pick a patient first', 'error'); return; }
    if (!policy) { showToast('Pick the insurance policy to claim against', 'error'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { showToast('Enter a claim amount greater than zero', 'error'); return; }
    setSubmittingClaim(true);
    try {
      const { submitClaim } = await import('@/lib/services/payment-service');
      const doc = await submitClaim({
        patientId: patient._id,
        patientName: patientFullName(patient),
        policyId: policy._id,
        payerName: policy.payerName,
        payerType: policy.payerType,
        billingId: bill?._id,
        encounterId: bill?.encounterId,
        chargeIds: [],
        totalBilled: amount,
        facilityId: currentUser?.hospitalId || '',
        facilityName: currentUser?.hospitalName || '',
        submittedBy: currentUser?.name || currentUser?.username || 'Unknown',
        orgId: currentUser?.orgId,
      });
      showToast(`Claim ${doc.claimNumber} submitted to ${policy.payerName}`, 'success');
      resetNewClaim();
      await onChanged();
    } catch (err) {
      console.error(err);
      showToast((err as Error).message || 'Could not submit the claim', 'error');
    } finally {
      setSubmittingClaim(false);
    }
  };

  const handleAdjudicate = (claim: ClaimDoc) => {
    setEditingId(claim._id);
    setAdjForm({
      claimId: claim._id,
      allowedAmount: claim.totalAllowed || claim.totalBilled || 0,
      paidAmount: claim.totalApproved || 0,
      denialReason: claim.denialReasons?.join(', ') || '',
      notes: '',
    });
  };

  // The persisted status is DERIVED from the amounts by the exact rule the
  // service applies (computeAdjudicatedStatus) — the modal shows a live
  // preview of that outcome instead of offering a status dropdown that the
  // save path would silently ignore.
  const adjPreview = useMemo(() => {
    if (!adjForm) return null;
    const allowed = Number.isFinite(adjForm.allowedAmount) ? Math.max(0, adjForm.allowedAmount) : 0;
    const paid = Number.isFinite(adjForm.paidAmount) ? Math.max(0, adjForm.paidAmount) : 0;
    return computeAdjudicatedStatus(paid, Math.max(0, allowed - paid));
  }, [adjForm]);

  const handleSaveAdjudication = async () => {
    if (!adjForm) return;
    try {
      const { adjudicateClaim } = await import('@/lib/services/payment-service');
      const allowed = Number.isFinite(adjForm.allowedAmount) ? Math.max(0, adjForm.allowedAmount) : 0;
      const paid = Number.isFinite(adjForm.paidAmount) ? Math.max(0, adjForm.paidAmount) : 0;
      await adjudicateClaim(
        adjForm.claimId,
        paid,
        Math.max(0, allowed - paid),
        0,
        0,
        currentUser?.name || 'Unknown',
        {
          totalAllowed: allowed,
          denialReasons: adjForm.denialReason?.trim() ? [adjForm.denialReason.trim()] : undefined,
          notes: adjForm.notes.trim() || undefined,
        },
      );
      await onChanged();
      setEditingId(null);
      setAdjForm(null);
    } catch (error) {
      console.error('Failed to save adjudication:', error);
      showToast('Could not save the adjudication', 'error');
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setAdjForm(null);
  };

  return (
    <>
      {visibleClaims.length === 0 ? (
        <div className="bl-empty">
          <AlertTriangle size={34} />
          <h3>{claims.length === 0 ? t('claims.emptyTitle') : 'No claims match these filters'}</h3>
          <p>{claims.length === 0 ? t('claims.emptyDescription') : 'Clear the status or payer filter to see the rest of the queue.'}</p>
        </div>
      ) : (
        <div style={{ overflow: 'auto', flex: 1, minHeight: 0, marginTop: 12 }}>
          <table className="bl-table bl-table--even bl-table--rows-open" style={{ minWidth: 980 }}>
            {/* `bl-table--even` is table-layout: fixed — equal shares of the
                full width, stable as rows load. */}
            <thead>
              <tr>
                {CLAIM_COLUMNS.map(c => ({ ...c, label: t(c.key) })).map(h => (
                  <th
                    key={h.label}
                    className={h.align === 'right' ? 'bl-right' : undefined}
                    style={{ position: 'sticky', top: 0, zIndex: 1 }}
                  >
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleClaims.map((claim) => (
                <tr
                  key={claim._id}
                  onClick={() => setOpenClaim(claim)}
                  tabIndex={0}
                  aria-label={`Open claim ${claim.claimNumber || ''}`}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenClaim(claim); } }}
                >
                  <td style={{ fontWeight: 600 }}>{claim.claimNumber}</td>
                  <td>
                    {claim.patientId && !claim.patientId.startsWith('demo-') && !claim.patientId.includes('_demo') ? (
                      <Link href={`/patients/${claim.patientId}?tab=billing`} onClick={e => e.stopPropagation()} className="bl-link">
                        {shortenPersonName(claim.patientName)}
                      </Link>
                    ) : (
                      claim.patientName
                    )}
                  </td>
                  <td>{claim.payerName}</td>
                  <td className="bl-muted">{t(PAYER_LABEL_KEYS[claim.payerType]) || claim.payerType}</td>
                  <td className="bl-num bl-right">{formatMoney(claim.totalBilled || 0)}</td>
                  <td className="bl-num bl-right">{formatMoney(claim.totalAllowed || 0)}</td>
                  <td className="bl-num bl-right">{formatMoney(claim.totalApproved || 0)}</td>
                  <td>
                    <span className={`bl-chip ${CLAIM_STATUS_CHIP[claim.status]}`}>{t(`claims.status_${claim.status}`)}</span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {claim.submittedDate ? new Date(claim.submittedDate).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Claim detail — the row's popup. It carries the lifecycle actions that
          used to hang off a per-row pencil menu, so the queue itself is just
          rows and the decisions are made with the full claim on screen. */}
      {openClaim && (
        <Modal onClose={() => setOpenClaim(null)} width={560} labelledBy="claim-detail-title">
          <div className="bl-root" style={{ display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden', maxHeight: 'calc(100vh - 32px)' }}>
            <div className="px-5 py-4 border-b flex items-start justify-between gap-3" style={{ borderColor: 'var(--ehr-border, #E2E6EB)' }}>
              <div className="min-w-0">
                <h2 className="bl-modal-title" id="claim-detail-title">{openClaim.claimNumber || 'Claim'}</h2>
                <p className="bl-card-sub" style={{ margin: '4px 0 0' }}>
                  {openClaim.payerName} · {t(PAYER_LABEL_KEYS[openClaim.payerType]) || openClaim.payerType}
                </p>
              </div>
              <span className={`bl-chip ${CLAIM_STATUS_CHIP[openClaim.status]}`}>{t(`claims.status_${openClaim.status}`)}</span>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
              <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--ehr-border, #E2E6EB)' }}>
                <div className="bl-stats" style={{ border: 'none', padding: 0 }}>
                  <div>
                    <span className="bl-stat-label">{t('claims.colBilled')}</span>
                    <span className="bl-stat-value">{formatMoney(openClaim.totalBilled || 0)}</span>
                  </div>
                  <div>
                    <span className="bl-stat-label">{t('claims.colAllowed')}</span>
                    <span className="bl-stat-value">{formatMoney(openClaim.totalAllowed || 0)}</span>
                  </div>
                  <div>
                    <span className="bl-stat-label">{t('claims.colPaid')}</span>
                    <span className={`bl-stat-value${(openClaim.totalApproved || 0) > 0 ? ' bl-stat-value--good' : ''}`}>
                      {formatMoney(openClaim.totalApproved || 0)}
                    </span>
                  </div>
                  {(openClaim.totalDenied || 0) > 0 && (
                    <div>
                      <span className="bl-stat-label">Denied</span>
                      <span className="bl-stat-value bl-stat-value--danger">{formatMoney(openClaim.totalDenied || 0)}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--ehr-border, #E2E6EB)' }}>
                <dl className="bl-totals">
                  <div className="bl-totals-row">
                    <dt>{t('claims.colPatientName')}</dt>
                    <dd>{openClaim.patientName}</dd>
                  </div>
                  <div className="bl-totals-row">
                    <dt>{t('claims.colSubmittedDate')}</dt>
                    <dd>{openClaim.submittedDate ? new Date(openClaim.submittedDate).toLocaleDateString() : '—'}</dd>
                  </div>
                  {openClaim.adjudicatedDate && (
                    <div className="bl-totals-row">
                      <dt>Adjudicated</dt>
                      <dd>{new Date(openClaim.adjudicatedDate).toLocaleDateString()}{openClaim.adjudicatedBy ? ` · ${openClaim.adjudicatedBy}` : ''}</dd>
                    </div>
                  )}
                  {!!openClaim.resubmissionCount && (
                    <div className="bl-totals-row">
                      <dt>Resubmissions</dt>
                      <dd>{openClaim.resubmissionCount}{openClaim.lastResubmittedAt ? ` · ${new Date(openClaim.lastResubmittedAt).toLocaleDateString()}` : ''}</dd>
                    </div>
                  )}
                  <div className="bl-totals-row">
                    <dt>{openClaim.facilityName ? 'Facility' : ''}</dt>
                    <dd>{openClaim.facilityName || ''}</dd>
                  </div>
                </dl>
              </div>

              {(openClaim.denialReasons?.length || openClaim.adjudicationNotes || openClaim.appealNote) && (
                <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--ehr-border, #E2E6EB)' }}>
                  {!!openClaim.denialReasons?.length && (
                    <p className="bl-modal-sub" style={{ margin: 0 }}>
                      <strong style={{ color: 'var(--color-danger, #D92B20)' }}>Denial reason:</strong> {openClaim.denialReasons.join(', ')}
                    </p>
                  )}
                  {openClaim.adjudicationNotes && (
                    <p className="bl-modal-sub" style={{ margin: '8px 0 0' }}><strong>Notes:</strong> {openClaim.adjudicationNotes}</p>
                  )}
                  {openClaim.appealNote && (
                    <p className="bl-modal-sub" style={{ margin: '8px 0 0' }}><strong>Appeal:</strong> {openClaim.appealNote}</p>
                  )}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t flex items-center gap-2 flex-wrap" style={{ borderColor: 'var(--ehr-border, #E2E6EB)' }}>
              {openClaim.patientId && !openClaim.patientId.startsWith('demo-') && !openClaim.patientId.includes('_demo') && (
                <button
                  type="button"
                  className="bl-btn bl-btn--ghost"
                  onClick={() => router.push(`/patients/${openClaim.patientId}?tab=billing`)}
                >
                  {t('payments.openPatientRecord')}
                </button>
              )}
              <div style={{ flex: 1 }} />
              {(openClaim.status === 'denied' || openClaim.status === 'appealed') && (
                <button
                  type="button"
                  className="bl-btn bl-btn--outline"
                  disabled={lifecycleBusy}
                  onClick={() => handleResubmit(openClaim)}
                >
                  {lifecycleBusy ? 'Working…' : 'Resubmit to payer'}
                </button>
              )}
              {openClaim.status === 'denied' && (
                <button
                  type="button"
                  className="bl-btn bl-btn--outline"
                  onClick={() => { setAppealNote(''); setAppealFor(openClaim); setOpenClaim(null); }}
                >
                  Appeal denial
                </button>
              )}
              {(openClaim.status === 'submitted' || openClaim.status === 'draft') && (
                <button
                  type="button"
                  className="bl-btn bl-btn--primary"
                  onClick={() => { handleAdjudicate(openClaim); setOpenClaim(null); }}
                >
                  {t('claims.actionAdjudicate')}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Adjudication modal */}
      {editingId && adjForm && (
        <Modal onClose={handleCancel} width={480} labelledBy="adj-claim-title">
          <div className="bl-root bl-modal-body">
            <h3 className="bl-modal-title" id="adj-claim-title">{t('claims.modalTitle')}</h3>

            <div className="bl-field">
              <label htmlFor="adj-status-preview">{t('claims.colStatus')}</label>
              {/* Derived, not chosen: the same amount rule the service persists.
                  Paid amount 0 with an allowed amount = full denial. */}
              {adjPreview && (
                <div
                  id="adj-status-preview"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 6,
                    border: '1px solid var(--ehr-border, #E2E6EB)', background: 'var(--ehr-page-bg, #FFFFFF)',
                  }}
                >
                  <span className={`bl-chip ${CLAIM_STATUS_CHIP[adjPreview]}`}>{t(`claims.status_${adjPreview}`)}</span>
                  <span className="bl-muted" style={{ fontSize: 12.5 }}>
                    Derived from the amounts below — set paid to 0 to deny the full allowed amount.
                  </span>
                </div>
              )}
            </div>

            <div className="bl-field">
              <label htmlFor="adj-allowed">{t('claims.labelAllowedAmount')}</label>
              <input
                id="adj-allowed"
                type="number"
                value={adjForm.allowedAmount}
                onChange={(e) => setAdjForm({ ...adjForm, allowedAmount: parseFloat(e.target.value) })}
              />
            </div>

            <div className="bl-field">
              <label htmlFor="adj-paid">{t('claims.labelPaidAmount')}</label>
              <input
                id="adj-paid"
                type="number"
                value={adjForm.paidAmount}
                onChange={(e) => setAdjForm({ ...adjForm, paidAmount: parseFloat(e.target.value) })}
              />
            </div>

            {(adjPreview === 'denied' || adjPreview === 'partial') && (
              <div className="bl-field">
                <label htmlFor="adj-denial">{t('claims.labelDenialReason')}</label>
                <input
                  id="adj-denial"
                  type="text"
                  value={adjForm.denialReason || ''}
                  onChange={(e) => setAdjForm({ ...adjForm, denialReason: e.target.value })}
                  placeholder={t('claims.denialReasonPlaceholder')}
                />
              </div>
            )}

            <div className="bl-field">
              <label htmlFor="adj-notes">{t('claims.labelNotes')}</label>
              <textarea
                id="adj-notes"
                rows={3}
                value={adjForm.notes}
                onChange={(e) => setAdjForm({ ...adjForm, notes: e.target.value })}
                placeholder={t('claims.notesPlaceholder')}
              />
            </div>

            <div className="bl-modal-actions">
              <button type="button" className="bl-btn bl-btn--ghost" onClick={handleCancel}>{t('action.cancel')}</button>
              <button type="button" className="bl-btn bl-btn--primary" onClick={handleSaveAdjudication}>{t('claims.saveAdjudication')}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Appeal modal — denied claim → appealed, with a note for the payer. */}
      {appealFor && (
        <Modal onClose={() => !lifecycleBusy && setAppealFor(null)} width={440} labelledBy="appeal-claim-title">
          <div className="bl-root bl-modal-body">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 className="bl-modal-title" id="appeal-claim-title">Appeal claim {appealFor.claimNumber}</h3>
              <button type="button" className="bl-row-menu-btn" onClick={() => !lifecycleBusy && setAppealFor(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <p className="bl-modal-sub">
              Denied by {appealFor.payerName} · billed {formatMoney(appealFor.totalBilled || 0)}
              {appealFor.denialReasons?.length ? ` · reason: ${appealFor.denialReasons.join(', ')}` : ''}
            </p>
            <div className="bl-field">
              <label htmlFor="appeal-note">Appeal note</label>
              <textarea
                id="appeal-note"
                rows={3}
                value={appealNote}
                onChange={e => setAppealNote(e.target.value)}
                placeholder="Why the denial should be reconsidered…"
                autoFocus
              />
            </div>
            <div className="bl-modal-actions">
              <button type="button" className="bl-btn bl-btn--ghost" disabled={lifecycleBusy} onClick={() => setAppealFor(null)}>Cancel</button>
              <button type="button" className="bl-btn bl-btn--primary" disabled={lifecycleBusy || !appealNote.trim()} onClick={handleAppeal}>
                {lifecycleBusy ? 'Submitting…' : 'Submit appeal'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* New claim modal — pick an insured patient, the policy, and the bill
          (or a manual amount), then submit through the real claims service. */}
      {newClaimOpen && (
        <Modal onClose={() => !submittingClaim && resetNewClaim()} width={480} labelledBy="new-claim-title">
          <div className="bl-root bl-modal-body">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 className="bl-modal-title" id="new-claim-title">New insurance claim</h3>
              <button type="button" className="bl-row-menu-btn" onClick={() => !submittingClaim && resetNewClaim()} aria-label="Close"><X size={16} /></button>
            </div>

            {/* Patient picker */}
            {newClaim.patientId ? (
              <div className="bl-id-tag" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 12px' }}>
                <strong>{patientFullName(patients.find(p => p._id === newClaim.patientId) || { firstName: 'Unknown', surname: '' } as never)}</strong>
                <button type="button" className="bl-link" onClick={() => setNewClaim(EMPTY_CLAIM)}>Change</button>
              </div>
            ) : (
              <div className="bl-field">
                <label htmlFor="claim-patient-search">Patient</label>
                <input
                  id="claim-patient-search"
                  type="text"
                  value={patientSearch}
                  onChange={e => setPatientSearch(e.target.value)}
                  placeholder="Search by name or hospital number…"
                  autoFocus
                />
                {patientSearch.trim().length >= 2 && (
                  <div className="bl-fee-list">
                    {patients
                      .filter(p => `${patientFullName(p)} ${p.hospitalNumber || ''}`.toLowerCase().includes(patientSearch.trim().toLowerCase()))
                      .slice(0, 6)
                      .map(p => (
                        <button
                          key={p._id}
                          type="button"
                          className="bl-fee-row"
                          onClick={() => setNewClaim(f => ({ ...f, patientId: p._id }))}
                          style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'start', font: 'inherit' }}
                        >
                          <div className="bl-fee-name">{patientFullName(p)}</div>
                          <span className="bl-fee-cat">{p.hospitalNumber || ''}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Policy picker */}
            {newClaim.patientId && (
              patientPolicies.length === 0 ? (
                <p className="bl-muted" style={{ fontSize: 12.5 }}>
                  This patient has no insurance policy on file — add one from their chart&rsquo;s Billing tab first.
                </p>
              ) : (
                <div className="bl-field">
                  <label htmlFor="claim-policy">Insurance policy</label>
                  <Select
                    id="claim-policy"
                    value={newClaim.policyId}
                    onChange={e => setNewClaim(f => ({ ...f, policyId: e.target.value }))}
                  >
                    <option value="">Select policy…</option>
                    {patientPolicies.map(pol => (
                      <option key={pol._id} value={pol._id}>
                        {pol.payerName}{pol.memberId ? ` · ${pol.memberId}` : ''}{pol.isPrimary ? ' (primary)' : ''}
                      </option>
                    ))}
                  </Select>
                </div>
              )
            )}

            {/* Bill or manual amount */}
            {newClaim.patientId && patientPolicies.length > 0 && (
              <>
                <div className="bl-field">
                  <label htmlFor="claim-bill">Bill to claim against</label>
                  <Select
                    id="claim-bill"
                    value={newClaim.billingId}
                    onChange={e => setNewClaim(f => ({ ...f, billingId: e.target.value }))}
                  >
                    <option value="">No linked bill — enter amount manually</option>
                    {patientBills.map(b => (
                      <option key={b._id} value={b._id}>
                        {formatMoney(b.balanceDue ?? 0)} outstanding · {(b.encounterDate || b.createdAt || '').slice(0, 10)}
                      </option>
                    ))}
                  </Select>
                </div>
                {!newClaim.billingId && (
                  <div className="bl-field">
                    <label htmlFor="claim-amount">Claim amount</label>
                    <input
                      id="claim-amount"
                      type="number"
                      min="0"
                      value={newClaim.amount}
                      onChange={e => setNewClaim(f => ({ ...f, amount: e.target.value }))}
                    />
                  </div>
                )}
              </>
            )}

            <div className="bl-modal-actions">
              <button type="button" className="bl-btn bl-btn--ghost" disabled={submittingClaim} onClick={resetNewClaim}>Cancel</button>
              <button
                type="button"
                className="bl-btn bl-btn--primary"
                disabled={submittingClaim || !newClaim.patientId || !newClaim.policyId || (!newClaim.billingId && !newClaim.amount)}
                onClick={handleSubmitNewClaim}
              >
                {submittingClaim ? 'Submitting…' : 'Submit claim'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * Status + payer options for the claims tab, fed into the toolbar's single
 * filter menu. Counts ride on the labels so the menu doubles as a breakdown.
 */
export function claimFilterOptions(claims: ClaimDoc[], t: (key: string) => string): {
  status: FilterOption[];
  payer: FilterOption[];
} {
  return {
    status: [
      { value: 'all', label: `All statuses (${claims.length})` },
      ...CLAIM_STATUSES.map(s => ({
        value: s,
        label: `${t(`claims.status_${s}`)} (${claims.filter(c => c.status === s).length})`,
      })),
    ],
    // Only payers that actually appear — an empty filter option is a dead end.
    payer: [
      { value: 'all', label: 'All payers' },
      ...Array.from(new Set(claims.map(c => c.payerType)))
        .map(p => ({ value: p, label: t(PAYER_LABEL_KEYS[p]) || p })),
    ],
  };
}
