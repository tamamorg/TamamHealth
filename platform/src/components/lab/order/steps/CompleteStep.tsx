'use client';

/**
 * Step 6 — Complete. The order is placed; this is the requisition that walks
 * with the specimen, plus the accession numbers the bench will label tubes
 * with.
 */

import { CheckCircle2, Printer } from '@/components/icons/lucide';
import { useApp } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import LabRequisition from '../LabRequisition';
import type { LabOrderController } from '../useLabOrderDraft';

export default function CompleteStep({ controller }: { controller: LabOrderController }) {
  const { t } = useTranslation();
  const { currentUser } = useApp();
  const { draft, patient, receipt, schedule } = controller;

  if (!receipt || !patient) return null;

  return (
    <div>
      <div
        className="labord-row"
        style={{ border: '1px solid var(--labord-line)', borderRadius: 4, marginBottom: 16, background: 'var(--labord-surface-soft)' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--color-success, #059669)' }} aria-hidden />
          <span>
            <span className="labord-pick-name">{t('labOrder.placed', { count: draft.tests.length })}</span>
            <span className="labord-pick-meta" style={{ display: 'block' }}>
              {t('labOrder.accessions')}: {receipt.accessionNumbers.join(', ') || receipt.orderGroupId}
            </span>
          </span>
        </span>
        <button type="button" className="labord-btn" onClick={() => window.print()}>
          <Printer className="w-4 h-4" aria-hidden /> {t('labOrder.print')}
        </button>
      </div>

      <LabRequisition
        draft={draft}
        patient={patient}
        receipt={receipt}
        facilityName={currentUser?.hospitalName || ''}
        schedule={schedule}
      />
    </div>
  );
}
