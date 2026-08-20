'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import { Shield, X } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useToast } from '@/components/Toast';
import type { InsurancePolicyDoc, PayerType } from '@/lib/db-types-payments';
import Select from '@/components/Select';
import { todayIso } from '@/lib/date-utils';

interface InsurancePolicyModalProps {
  patientId: string;
  /** Pass an existing policy to edit it; omit/null to add a new one. */
  policy?: InsurancePolicyDoc | null;
  facilityId: string;
  orgId?: string;
  createdBy?: string;
  onClose: () => void;
  onSaved: () => void;
}

const PAYER_TYPES: { value: PayerType; label: string }[] = [
  { value: 'private', label: 'Private Insurance' },
  { value: 'nhis', label: 'National Insurance (NHIS)' },
  { value: 'cbhi', label: 'Community Insurance (CBHI)' },
  { value: 'government', label: 'Government' },
  { value: 'donor', label: 'Donor / NGO Funded' },
  { value: 'employer', label: 'Employer' },
  { value: 'self_pay', label: 'Out-of-Pocket' },
];

const DONOR_COVERAGE_TYPES: { value: NonNullable<InsurancePolicyDoc['donorCoverageType']>; label: string }[] = [
  { value: 'full', label: 'Full coverage' },
  { value: 'partial', label: 'Partial coverage' },
  { value: 'emergency_only', label: 'Emergency only' },
];

const today = () => todayIso();

export default function InsurancePolicyModal({
  patientId, policy, facilityId, orgId, createdBy, onClose, onSaved,
}: InsurancePolicyModalProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const isEdit = !!policy;

  const [form, setForm] = useState({
    payerType: (policy?.payerType ?? 'private') as PayerType,
    payerName: policy?.payerName ?? '',
    memberId: policy?.memberId ?? '',
    groupNumber: policy?.groupNumber ?? '',
    policyNumber: policy?.policyNumber ?? '',
    effectiveDate: policy?.effectiveDate ?? today(),
    terminationDate: policy?.terminationDate ?? '',
    isPrimary: policy?.isPrimary ?? false,
    copayAmount: policy?.copayAmount,
    coinsurancePct: policy?.coinsurancePct,
    coverageNotes: policy?.coverageNotes ?? '',
    donorProgramId: policy?.donorProgramId ?? '',
    donorCoverageType: policy?.donorCoverageType,
  });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    if (!form.payerName.trim()) {
      showToast(t('billing.payerNameRequired') || 'Payer / plan name is required', 'error');
      return;
    }
    if (!form.effectiveDate) {
      showToast(t('billing.effectiveDateRequired') || 'Effective date is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const svc = await import('@/lib/services/payment-service');
      const shared = {
        payerType: form.payerType,
        payerName: form.payerName.trim(),
        memberId: form.memberId.trim() || undefined,
        groupNumber: form.groupNumber.trim() || undefined,
        policyNumber: form.policyNumber.trim() || undefined,
        effectiveDate: form.effectiveDate,
        terminationDate: form.terminationDate || undefined,
        isPrimary: form.isPrimary,
        copayAmount: form.copayAmount != null && !Number.isNaN(form.copayAmount) ? form.copayAmount : undefined,
        coinsurancePct: form.coinsurancePct != null && !Number.isNaN(form.coinsurancePct) ? form.coinsurancePct : undefined,
        coverageNotes: form.coverageNotes.trim() || undefined,
        donorProgramId: form.payerType === 'donor' ? (form.donorProgramId.trim() || undefined) : undefined,
        donorCoverageType: form.payerType === 'donor' ? form.donorCoverageType : undefined,
      };

      if (isEdit && policy) {
        await svc.updateInsurancePolicy(policy._id, shared);
      } else {
        await svc.createInsurancePolicy({
          patientId,
          facilityId,
          orgId,
          createdBy,
          ...shared,
        });
      }
      showToast(
        isEdit
          ? (t('billing.insuranceUpdated') || 'Insurance policy updated')
          : (t('billing.insuranceAdded') || 'Insurance policy added'),
        'success'
      );
      onSaved();
    } catch (err) {
      console.error('Failed to save insurance policy:', err);
      showToast(t('billing.insuranceSaveFailed') || 'Failed to save insurance policy', 'error');
    }
    setSaving(false);
  };

  return (
    <Modal onClose={onClose} width={480}>
      <div className="modal-panel modal-panel--sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="icon-box-sm">
              <Shield className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
            </div>
            <h3 className="text-base font-semibold">
              {isEdit
                ? (t('billing.editInsurance') || 'Edit insurance policy')
                : (t('billing.addInsurance') || 'Add insurance policy')}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3" style={{ maxHeight: '60vh', overflowY: 'auto', paddingInlineEnd: 4 }}>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>
              {t('billing.payerType') || 'Payer type'}
            </label>
            <Select value={form.payerType} onChange={e => set('payerType', e.target.value as PayerType)}>
              {PAYER_TYPES.map(pt => <option key={pt.value} value={pt.value}>{pt.label}</option>)}
            </Select>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>
              {t('billing.payerName') || 'Payer / plan name'}
            </label>
            <input type="text" value={form.payerName} onChange={e => set('payerName', e.target.value)} placeholder="e.g. AAR Insurance" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>
                {t('billing.memberId') || 'Member ID'}
              </label>
              <input type="text" value={form.memberId} onChange={e => set('memberId', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>
                {t('billing.groupNumber') || 'Group number'}
              </label>
              <input type="text" value={form.groupNumber} onChange={e => set('groupNumber', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>
              {t('billing.policyNumber') || 'Policy number'}
            </label>
            <input type="text" value={form.policyNumber} onChange={e => set('policyNumber', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>
                {t('billing.effectiveDate') || 'Effective date'}
              </label>
              <input type="date" value={form.effectiveDate} onChange={e => set('effectiveDate', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>
                {t('billing.terminationDate') || 'Termination date'}
              </label>
              <input type="date" value={form.terminationDate} onChange={e => set('terminationDate', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>
                {t('billing.copayAmount') || 'Copay amount'}
              </label>
              <input
                type="number" min={0} value={form.copayAmount ?? ''}
                onChange={e => set('copayAmount', e.target.value === '' ? undefined : parseFloat(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>
                {t('billing.coinsurancePct') || 'Coinsurance %'}
              </label>
              <input
                type="number" min={0} max={100} value={form.coinsurancePct ?? ''}
                onChange={e => set('coinsurancePct', e.target.value === '' ? undefined : parseFloat(e.target.value))}
              />
            </div>
          </div>

          {form.payerType === 'donor' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  {t('billing.donorProgramId') || 'Donor program ID'}
                </label>
                <input type="text" value={form.donorProgramId} onChange={e => set('donorProgramId', e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  {t('billing.donorCoverageType') || 'Coverage type'}
                </label>
                <Select
                  value={form.donorCoverageType ?? ''}
                  onChange={e => set('donorCoverageType', (e.target.value || undefined) as typeof form.donorCoverageType)}
                >
                  <option value="">{t('common.select') || 'Select…'}</option>
                  {DONOR_COVERAGE_TYPES.map(dc => <option key={dc.value} value={dc.value}>{dc.label}</option>)}
                </Select>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>
              {t('billing.coverageNotes') || 'Coverage notes'}
            </label>
            <textarea rows={2} value={form.coverageNotes} onChange={e => set('coverageNotes', e.target.value)} placeholder={t('common.optional') || 'Optional'} />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={form.isPrimary} onChange={e => set('isPrimary', e.target.checked)} />
            {t('billing.setAsPrimaryPolicy') || 'Set as primary policy'}
          </label>
        </div>

        <hr className="section-divider" />
        <div className="flex gap-2 mt-2">
          <button onClick={onClose} className="btn btn-secondary flex-1">{t('common.cancel') || 'Cancel'}</button>
          <button onClick={handleSubmit} disabled={saving} className="btn btn-primary flex-1">
            {saving ? (t('common.saving') || 'Saving…') : (t('common.save') || 'Save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
